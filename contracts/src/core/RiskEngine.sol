// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IRiskEngine} from "../interfaces/IRiskEngine.sol";

/// @title RiskEngine
/// @notice Composite on-chain risk scoring with contract-level BLOCK and anti-downgrade TADE.
///
/// @dev **The verdict is computed here, not asserted by the attester.** An attestation carries
///      eight per-vector severities. This contract multiplies them by on-chain weights and derives
///      CLEAR / WARN / BLOCK itself. A compromised attester can therefore inflate risk but cannot
///      declare a drainer "clear" while reporting the severities that prove otherwise.
///
///      **Anti-downgrade (TADE).** While an attestation is inside its validity window it may only
///      be replaced by one of equal or greater severity. Two distinct downgrade routes exist and
///      both are closed:
///        1. verdict downgrade — BLOCK overwritten by CLEAR/WARN;
///        2. window shortening — BLOCK overwritten by another BLOCK that expires sooner, which is
///           a downgrade in every sense that matters. Re-attesting at the same verdict must not
///           move the expiry backwards.
///      There is no admin override. That is deliberate: an escape hatch is a downgrade route with
///      extra steps. Liveness comes from the window being bounded by `HARD_MAX_VALIDITY` instead.
///
///      **Why blocks are recorded at attestation time.** `enforceIntent` is a view that reverts.
///      An event emitted on the blocked path would be rolled back with the transaction and could
///      never back a public "prevented $X" figure. The durable record is `RiskBlocked`, emitted
///      when the BLOCK attestation is stored, carrying the value at risk.
contract RiskEngine is IRiskEngine, AccessControl {
    // --------------------------------------------------------------------------------------
    // Types
    // --------------------------------------------------------------------------------------

    /// @notice Severity byte positions inside the packed `severities` word.
    enum Vector {
        ADDRESS_POISONING,
        UNLIMITED_APPROVAL,
        DRAINER_SIGNATURE,
        SANCTIONED_COUNTERPARTY,
        ANOMALOUS_VALUE,
        PERMISSION_ESCALATION,
        CONTRACT_REPUTATION,
        VELOCITY_ANOMALY
    }

    struct Attestation {
        // slot 0
        address attester;
        uint64 issuedAt;
        uint16 score; // basis points, 0..10_000
        uint8 verdict; // IRiskEngine.Verdict
        // slot 1
        uint64 expiresAt;
        uint64 severities; // eight uint8 severities, vector i at byte i
        // slot 2
        uint256 valueAtRisk;
    }

    /// @notice Per-mode policy applied when no valid attestation covers an intent.
    struct ModePolicy {
        uint256 unattestedValueCap; // max native value movable without a live attestation
        bool allowWarn; // may a WARN attestation still execute
    }

    // --------------------------------------------------------------------------------------
    // Constants
    // --------------------------------------------------------------------------------------

    bytes32 public constant ATTESTER_ROLE = keccak256("GEBRID.RiskEngine.ATTESTER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GEBRID.RiskEngine.GUARDIAN_ROLE");
    bytes32 public constant CONFIG_ROLE = keccak256("GEBRID.RiskEngine.CONFIG_ROLE");

    uint256 public constant VECTOR_COUNT = 8;
    uint256 public constant MAX_SEVERITY = 100;
    uint16 public constant SCORE_SCALE = 10_000;

    /// @notice Upper bound on how long any attestation can stay in force. Because BLOCK cannot be
    ///         lifted early, this is also the worst-case denial-of-service window a rogue attester
    ///         can impose on one agent.
    uint64 public constant HARD_MAX_VALIDITY = 7 days;
    uint64 public constant HARD_MIN_VALIDITY = 1 minutes;

    /// @dev Subject tags. Distinct tags plus chain id plus this contract's address mean an
    ///      attestation cannot be replayed across subjects, contracts, deployments or chains.
    bytes32 private constant AGENT_SUBJECT_TAG = keccak256("GEBRID.RiskSubject.Agent.v1");
    bytes32 private constant INTENT_SUBJECT_TAG = keccak256("GEBRID.RiskSubject.Intent.v1");

    // --------------------------------------------------------------------------------------
    // Storage
    // --------------------------------------------------------------------------------------

    Mode public mode;
    uint64 public modeChangedAt;
    uint64 public deEscalationDelay;
    uint64 public minValidity;
    uint64 public maxValidity;

    uint16 public warnThresholdBps;
    uint16 public blockThresholdBps;

    /// @notice Weight of each vector in basis points. Must sum to SCORE_SCALE.
    uint16[8] public weightsBps;

    /// @notice Bitmap of vectors that force BLOCK at maximum severity regardless of weighting.
    /// @dev Bits can only ever be added. A mandatory vector cannot be switched off.
    uint8 public mandatoryMask;

    mapping(bytes32 subject => Attestation) private _attestations;
    mapping(address target => bool) public denylisted;
    mapping(Mode operatingMode => ModePolicy) private _policy;

    // --------------------------------------------------------------------------------------
    // Events
    // --------------------------------------------------------------------------------------

    event AttestationRecorded(
        bytes32 indexed subject,
        address indexed attester,
        uint8 verdict,
        uint16 score,
        uint64 severities,
        uint64 expiresAt,
        uint256 valueAtRisk
    );
    /// @notice Durable, non-revertible record of a block. Source of the public prevented-loss metric.
    event RiskBlocked(
        bytes32 indexed subject, address indexed attester, uint256 valueAtRisk, uint16 score, uint64 severities
    );
    event ModeChanged(Mode indexed previousMode, Mode indexed newMode, address indexed actor);
    event ModePolicyUpdated(Mode indexed forMode, uint256 unattestedValueCap, bool allowWarn);
    event WeightsUpdated(uint16[8] weightsBps);
    event ThresholdsUpdated(uint16 warnThresholdBps, uint16 blockThresholdBps);
    event ValidityBoundsUpdated(uint64 minValidity, uint64 maxValidity);
    event DeEscalationDelayUpdated(uint64 delay);
    event MandatoryVectorAdded(Vector indexed vector);
    event DenylistUpdated(address indexed target, bool denied);

    // --------------------------------------------------------------------------------------
    // Errors
    // --------------------------------------------------------------------------------------

    error ZeroAddress();
    error InvalidSeverity(uint256 vectorIndex, uint256 severity);
    error InvalidValidity(uint64 requested, uint64 min, uint64 max);
    error InvalidThresholds(uint16 warnBps, uint16 blockBps);
    error WeightsMustSumToScale(uint256 sum, uint16 scale);
    error InvalidValidityBounds(uint64 min, uint64 max);
    error DowngradeRejected(uint8 currentVerdict, uint8 newVerdict, uint64 currentExpiry);
    error WindowShorteningRejected(uint64 currentExpiry, uint64 newExpiry);
    error ModeUnchanged();
    error DeEscalationTooSoon(uint64 allowedAt);
    error TargetDenylisted(address target);
    error AgentBlocked(address account, uint64 until);
    error IntentBlocked(bytes32 subject, uint16 score, uint64 until);
    error WarnNotPermittedInMode(Mode currentMode);
    error AttestationRequired(Mode currentMode, uint256 value, uint256 cap);

    // --------------------------------------------------------------------------------------
    // Construction
    // --------------------------------------------------------------------------------------

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(ATTESTER_ROLE, admin);

        // 8 vectors, equal weight, summing to 10_000.
        weightsBps = [uint16(1250), 1250, 1250, 1250, 1250, 1250, 1250, 1250];
        warnThresholdBps = 3000;
        blockThresholdBps = 7000;

        minValidity = 5 minutes;
        maxValidity = 1 days;
        deEscalationDelay = 6 hours;
        modeChangedAt = uint64(block.timestamp);

        // A maxed-out sanctions hit or drainer-signature match blocks on its own, whatever the
        // weighted score says.
        mandatoryMask = _vectorBit(Vector.SANCTIONED_COUNTERPARTY) | _vectorBit(Vector.DRAINER_SIGNATURE);

        _policy[Mode.NORMAL] = ModePolicy({unattestedValueCap: type(uint256).max, allowWarn: true});
        _policy[Mode.RESTRICTED] = ModePolicy({unattestedValueCap: 0, allowWarn: true});
        _policy[Mode.CRISIS] = ModePolicy({unattestedValueCap: 0, allowWarn: false});
    }

    // --------------------------------------------------------------------------------------
    // Subjects
    // --------------------------------------------------------------------------------------

    /// @notice Subject covering every intent of one agent account.
    function agentSubject(address account) public view returns (bytes32) {
        return keccak256(abi.encode(AGENT_SUBJECT_TAG, block.chainid, address(this), account));
    }

    /// @notice Subject covering one exact intent.
    function intentSubject(address account, address target, uint256 value, bytes4 selector, bytes32 dataHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(INTENT_SUBJECT_TAG, block.chainid, address(this), account, target, value, selector, dataHash)
        );
    }

    // --------------------------------------------------------------------------------------
    // Attestation
    // --------------------------------------------------------------------------------------

    /// @notice Records an attestation for `subject`, deriving the verdict from the severities.
    function submitAttestation(bytes32 subject, uint64 severities, uint256 valueAtRisk, uint64 validitySeconds)
        external
        onlyRole(ATTESTER_ROLE)
        returns (uint8 verdict, uint16 score)
    {
        if (validitySeconds < minValidity || validitySeconds > maxValidity) {
            revert InvalidValidity(validitySeconds, minValidity, maxValidity);
        }

        (verdict, score) = _evaluate(severities);
        uint64 expiresAt = uint64(block.timestamp) + validitySeconds;

        Attestation storage current = _attestations[subject];
        if (current.verdict != uint8(Verdict.NONE) && block.timestamp < current.expiresAt) {
            if (verdict < current.verdict) revert DowngradeRejected(current.verdict, verdict, current.expiresAt);
            if (verdict == current.verdict && expiresAt < current.expiresAt) {
                revert WindowShorteningRejected(current.expiresAt, expiresAt);
            }
        }

        current.attester = msg.sender;
        current.issuedAt = uint64(block.timestamp);
        current.score = score;
        current.verdict = verdict;
        current.expiresAt = expiresAt;
        current.severities = severities;
        current.valueAtRisk = valueAtRisk;

        emit AttestationRecorded(subject, msg.sender, verdict, score, severities, expiresAt, valueAtRisk);
        if (verdict == uint8(Verdict.BLOCK)) {
            emit RiskBlocked(subject, msg.sender, valueAtRisk, score, severities);
        }
    }

    /// @notice Composite score and verdict for a severity vector, without recording anything.
    function evaluate(uint64 severities) external view returns (uint8 verdict, uint16 score) {
        return _evaluate(severities);
    }

    function _evaluate(uint64 severities) private view returns (uint8 verdict, uint16 score) {
        uint256 weighted;
        uint8 mandatory = mandatoryMask;
        bool forcedBlock;

        for (uint256 i = 0; i < VECTOR_COUNT; ++i) {
            // Truncation is the point: this extracts byte i of the packed severity word.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint256 severity = uint256(uint8(severities >> (i * 8)));
            if (severity > MAX_SEVERITY) revert InvalidSeverity(i, severity);
            weighted += severity * uint256(weightsBps[i]);
            if (severity == MAX_SEVERITY && ((mandatory >> i) & 1) != 0) forcedBlock = true;
        }

        // severity <= MAX_SEVERITY (100) and the weights are forced to sum to SCORE_SCALE
        // (10_000), so `weighted` <= 1_000_000 and the quotient <= 10_000. Fits uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        score = uint16(weighted / 100);

        if (forcedBlock || score >= blockThresholdBps) return (uint8(Verdict.BLOCK), score);
        if (score >= warnThresholdBps) return (uint8(Verdict.WARN), score);
        return (uint8(Verdict.CLEAR), score);
    }

    function attestationOf(bytes32 subject) external view returns (Attestation memory) {
        return _attestations[subject];
    }

    // --------------------------------------------------------------------------------------
    // Enforcement
    // --------------------------------------------------------------------------------------

    /// @inheritdoc IRiskEngine
    function enforceIntent(address account, address target, uint256 value, bytes4 selector, bytes32 dataHash)
        external
        view
    {
        if (denylisted[target]) revert TargetDenylisted(target);

        Mode currentMode = mode;
        ModePolicy storage policy = _policy[currentMode];

        Attestation storage agentAtt = _attestations[agentSubject(account)];
        if (agentAtt.verdict != uint8(Verdict.NONE) && block.timestamp < agentAtt.expiresAt) {
            if (agentAtt.verdict == uint8(Verdict.BLOCK)) revert AgentBlocked(account, agentAtt.expiresAt);
            if (agentAtt.verdict == uint8(Verdict.WARN) && !policy.allowWarn) {
                revert WarnNotPermittedInMode(currentMode);
            }
        }

        bytes32 subject = intentSubject(account, target, value, selector, dataHash);
        Attestation storage intentAtt = _attestations[subject];
        if (intentAtt.verdict != uint8(Verdict.NONE) && block.timestamp < intentAtt.expiresAt) {
            if (intentAtt.verdict == uint8(Verdict.BLOCK)) {
                revert IntentBlocked(subject, intentAtt.score, intentAtt.expiresAt);
            }
            if (intentAtt.verdict == uint8(Verdict.WARN) && !policy.allowWarn) {
                revert WarnNotPermittedInMode(currentMode);
            }
            return; // CLEAR, or WARN permitted in this mode.
        }

        // No live intent attestation: fall back to the mode's unattested allowance.
        if (value > policy.unattestedValueCap) {
            revert AttestationRequired(currentMode, value, policy.unattestedValueCap);
        }
    }

    /// @notice Non-reverting form of `enforceIntent`, for SDK, Snap and indexer use.
    function checkIntent(address account, address target, uint256 value, bytes4 selector, bytes32 dataHash)
        external
        view
        returns (bool allowed, uint8 verdict, uint16 score)
    {
        Attestation storage intentAtt = _attestations[intentSubject(account, target, value, selector, dataHash)];
        bool live = intentAtt.verdict != uint8(Verdict.NONE) && block.timestamp < intentAtt.expiresAt;
        verdict = live ? intentAtt.verdict : uint8(Verdict.NONE);
        score = live ? intentAtt.score : 0;

        try this.enforceIntent(account, target, value, selector, dataHash) {
            allowed = true;
        } catch {
            allowed = false;
        }
    }

    // --------------------------------------------------------------------------------------
    // Mode control
    // --------------------------------------------------------------------------------------

    /// @notice Escalation is immediate and available to guardians. De-escalation needs the admin
    ///         role and a cooldown, mirroring the attestation-level anti-downgrade rule.
    function setMode(Mode newMode) external {
        Mode currentMode = mode;
        if (newMode == currentMode) revert ModeUnchanged();

        if (newMode > currentMode) {
            _checkRole(GUARDIAN_ROLE);
        } else {
            _checkRole(DEFAULT_ADMIN_ROLE);
            uint64 allowedAt = modeChangedAt + deEscalationDelay;
            if (block.timestamp < allowedAt) revert DeEscalationTooSoon(allowedAt);
        }

        mode = newMode;
        modeChangedAt = uint64(block.timestamp);
        emit ModeChanged(currentMode, newMode, msg.sender);
    }

    function policyOf(Mode forMode) external view returns (ModePolicy memory) {
        return _policy[forMode];
    }

    // --------------------------------------------------------------------------------------
    // Configuration
    // --------------------------------------------------------------------------------------

    function setModePolicy(Mode forMode, uint256 unattestedValueCap, bool allowWarn) external onlyRole(CONFIG_ROLE) {
        _policy[forMode] = ModePolicy({unattestedValueCap: unattestedValueCap, allowWarn: allowWarn});
        emit ModePolicyUpdated(forMode, unattestedValueCap, allowWarn);
    }

    function setWeights(uint16[8] calldata newWeights) external onlyRole(CONFIG_ROLE) {
        uint256 sum;
        for (uint256 i = 0; i < VECTOR_COUNT; ++i) {
            sum += newWeights[i];
        }
        if (sum != SCORE_SCALE) revert WeightsMustSumToScale(sum, SCORE_SCALE);
        weightsBps = newWeights;
        emit WeightsUpdated(newWeights);
    }

    function setThresholds(uint16 warnBps, uint16 blockBps) external onlyRole(CONFIG_ROLE) {
        if (warnBps == 0 || warnBps > blockBps || blockBps > SCORE_SCALE) revert InvalidThresholds(warnBps, blockBps);
        warnThresholdBps = warnBps;
        blockThresholdBps = blockBps;
        emit ThresholdsUpdated(warnBps, blockBps);
    }

    function setValidityBounds(uint64 newMin, uint64 newMax) external onlyRole(CONFIG_ROLE) {
        if (newMin < HARD_MIN_VALIDITY || newMax > HARD_MAX_VALIDITY || newMin > newMax) {
            revert InvalidValidityBounds(newMin, newMax);
        }
        minValidity = newMin;
        maxValidity = newMax;
        emit ValidityBoundsUpdated(newMin, newMax);
    }

    function setDeEscalationDelay(uint64 delay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        deEscalationDelay = delay;
        emit DeEscalationDelayUpdated(delay);
    }

    /// @notice Adds a vector to the mandatory set. There is no removal: a mandatory vector is
    ///         non-disableable by construction, not by policy.
    function addMandatoryVector(Vector vector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mandatoryMask |= _vectorBit(vector);
        emit MandatoryVectorAdded(vector);
    }

    /// @dev `Vector` has 8 members, so the index is at most 7 and 2**7 = 128 always fits in uint8.
    ///      Written as exponentiation rather than `1 << index` so no widening cast is involved.
    function _vectorBit(Vector vector) private pure returns (uint8) {
        return uint8(2) ** uint8(vector);
    }

    function setDenylisted(address target, bool denied) external onlyRole(GUARDIAN_ROLE) {
        denylisted[target] = denied;
        emit DenylistUpdated(target, denied);
    }
}
