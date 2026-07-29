// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {RiskEngine} from "../src/core/RiskEngine.sol";
import {IRiskEngine} from "../src/interfaces/IRiskEngine.sol";
import {GebridTestBase} from "./utils/GebridTestBase.sol";

/// @dev Harness note: every `risk.*()` read is hoisted into a local before a `prank` or
///      `expectRevert` is armed. A view call in argument position is still an external call and
///      would consume the prank, or be mistaken for the call expected to revert.
contract RiskEngineTest is GebridTestBase {
    event RiskBlocked(
        bytes32 indexed subject, address indexed attester, uint256 valueAtRisk, uint16 score, uint64 severities
    );

    address internal agentAccount = makeAddr("agentAccount");
    address internal target = makeAddr("target");
    bytes4 internal constant SELECTOR = bytes4(keccak256("transfer(address,uint256)"));
    bytes32 internal constant DATA_HASH = keccak256("calldata");

    bytes32 internal intentSubject;
    bytes32 internal agentSubject;
    bytes32 internal attesterRole;
    bytes32 internal guardianRole;

    function setUp() public virtual override {
        super.setUp();
        intentSubject = risk.intentSubject(agentAccount, target, 1 ether, SELECTOR, DATA_HASH);
        agentSubject = risk.agentSubject(agentAccount);
        attesterRole = risk.ATTESTER_ROLE();
        guardianRole = risk.GUARDIAN_ROLE();
    }

    function _enforce() internal view {
        risk.enforceIntent(agentAccount, target, 1 ether, SELECTOR, DATA_HASH);
    }

    // --------------------------------------------------------------------------------------
    // Composite scoring
    // --------------------------------------------------------------------------------------

    function test_ScoreIsWeightedSumOfSeverities() public view {
        (uint8 verdict, uint16 score) = risk.evaluate(_clearSeverities());
        assertEq(score, 0);
        assertEq(verdict, uint8(IRiskEngine.Verdict.CLEAR));

        (verdict, score) = risk.evaluate(_warnSeverities());
        assertEq(score, 3750, "3 vectors at 100 x 1250bps / 100");
        assertEq(verdict, uint8(IRiskEngine.Verdict.WARN));

        (verdict, score) = risk.evaluate(_blockingSeverities());
        assertEq(score, 7500, "6 vectors at 100");
        assertEq(verdict, uint8(IRiskEngine.Verdict.BLOCK));
    }

    /// @dev The verdict is derived here, not taken from the attester. A rogue attester reporting
    ///      a maxed-out sanctions hit cannot have it come out as anything but BLOCK.
    function test_MandatoryVectorForcesBlockRegardlessOfWeights() public {
        // Zero every weight except one non-mandatory vector, so the weighted score of a sanctions
        // hit is 0. The mandatory rule must still block.
        uint16[8] memory weights;
        weights[uint256(uint8(RiskEngine.Vector.CONTRACT_REPUTATION))] = 10_000;
        vm.prank(admin);
        risk.setWeights(weights);

        uint64 sanctioned = _severities([uint8(0), 0, 0, 100, 0, 0, 0, 0]);
        (uint8 verdict, uint16 score) = risk.evaluate(sanctioned);
        assertEq(score, 0, "weighted score is zero");
        assertEq(verdict, uint8(IRiskEngine.Verdict.BLOCK), "mandatory vector must still block");
    }

    function test_MandatoryVectorsCanOnlyBeAdded() public {
        uint8 beforeMask = risk.mandatoryMask();
        vm.prank(admin);
        risk.addMandatoryVector(RiskEngine.Vector.ADDRESS_POISONING);
        uint8 afterMask = risk.mandatoryMask();

        assertEq(afterMask & beforeMask, beforeMask, "existing mandatory bits must survive");
        assertGt(afterMask, beforeMask);
    }

    function test_RevertWhen_SeverityAboveMax() public {
        uint64 bad = _severities([uint8(101), 0, 0, 0, 0, 0, 0, 0]);
        vm.expectRevert(abi.encodeWithSelector(RiskEngine.InvalidSeverity.selector, uint256(0), uint256(101)));
        risk.evaluate(bad);
    }

    function test_RevertWhen_WeightsDoNotSumToScale() public {
        uint16[8] memory weights;
        weights[0] = 9_999;
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(RiskEngine.WeightsMustSumToScale.selector, uint256(9_999), uint16(10_000))
        );
        risk.setWeights(weights);
    }

    // --------------------------------------------------------------------------------------
    // Anti-downgrade TADE
    // --------------------------------------------------------------------------------------

    function test_Adversarial_BlockCannotBeDowngradedToClear() public {
        uint64 blocking = _blockingSeverities();
        uint64 clear = _clearSeverities();
        uint64 expiry = uint64(block.timestamp + 1 hours);

        vm.startPrank(admin);
        risk.submitAttestation(intentSubject, blocking, 5 ether, 1 hours);

        vm.expectRevert(
            abi.encodeWithSelector(
                RiskEngine.DowngradeRejected.selector,
                uint8(IRiskEngine.Verdict.BLOCK),
                uint8(IRiskEngine.Verdict.CLEAR),
                expiry
            )
        );
        risk.submitAttestation(intentSubject, clear, 0, 1 hours);
        vm.stopPrank();
    }

    function test_Adversarial_BlockCannotBeDowngradedToWarn() public {
        uint64 blocking = _blockingSeverities();
        uint64 warn = _warnSeverities();
        uint64 expiry = uint64(block.timestamp + 1 hours);

        vm.startPrank(admin);
        risk.submitAttestation(intentSubject, blocking, 5 ether, 1 hours);

        vm.expectRevert(
            abi.encodeWithSelector(
                RiskEngine.DowngradeRejected.selector,
                uint8(IRiskEngine.Verdict.BLOCK),
                uint8(IRiskEngine.Verdict.WARN),
                expiry
            )
        );
        risk.submitAttestation(intentSubject, warn, 0, 1 hours);
        vm.stopPrank();
    }

    /// @dev The subtle downgrade: re-attest at the same BLOCK verdict but with a window that ends
    ///      sooner. Without this rule the block can be cut to the minimum validity and waited out.
    function test_Adversarial_BlockWindowCannotBeShortened() public {
        uint64 blocking = _blockingSeverities();
        uint64 originalExpiry = uint64(block.timestamp + 12 hours);
        uint64 shortenedExpiry = uint64(block.timestamp + 5 minutes);

        vm.startPrank(admin);
        risk.submitAttestation(intentSubject, blocking, 5 ether, 12 hours);

        vm.expectRevert(
            abi.encodeWithSelector(RiskEngine.WindowShorteningRejected.selector, originalExpiry, shortenedExpiry)
        );
        risk.submitAttestation(intentSubject, blocking, 5 ether, 5 minutes);
        vm.stopPrank();

        // The original block is still standing.
        vm.expectRevert(
            abi.encodeWithSelector(RiskEngine.IntentBlocked.selector, intentSubject, uint16(7500), originalExpiry)
        );
        _enforce();
    }

    function test_BlockWindowCanBeExtended() public {
        uint64 blocking = _blockingSeverities();
        vm.startPrank(admin);
        risk.submitAttestation(intentSubject, blocking, 5 ether, 1 hours);
        risk.submitAttestation(intentSubject, blocking, 5 ether, 2 hours);
        vm.stopPrank();

        assertEq(risk.attestationOf(intentSubject).expiresAt, uint64(block.timestamp + 2 hours));
    }

    function test_EscalationIsAlwaysAllowed() public {
        uint64 clear = _clearSeverities();
        uint64 warn = _warnSeverities();
        uint64 blocking = _blockingSeverities();

        vm.startPrank(admin);
        risk.submitAttestation(intentSubject, clear, 0, 1 hours);
        risk.submitAttestation(intentSubject, warn, 0, 1 hours);
        risk.submitAttestation(intentSubject, blocking, 3 ether, 1 hours);
        vm.stopPrank();

        assertEq(risk.attestationOf(intentSubject).verdict, uint8(IRiskEngine.Verdict.BLOCK));
    }

    function test_DowngradeIsAllowedOnlyAfterTheWindowExpires() public {
        uint64 blocking = _blockingSeverities();
        uint64 clear = _clearSeverities();

        vm.prank(admin);
        risk.submitAttestation(intentSubject, blocking, 5 ether, 1 hours);

        vm.warp(block.timestamp + 1 hours);

        vm.prank(admin);
        risk.submitAttestation(intentSubject, clear, 0, 1 hours);
        assertEq(risk.attestationOf(intentSubject).verdict, uint8(IRiskEngine.Verdict.CLEAR));
        _enforce(); // no longer reverts
    }

    /// @dev A BLOCK is bounded by HARD_MAX_VALIDITY, so a rogue attester cannot brick an agent
    ///      permanently. This is the liveness counterweight to having no admin override.
    function test_ValidityCannotExceedHardMax() public {
        uint64 hardMax = risk.HARD_MAX_VALIDITY();
        uint64 tooLong = hardMax + 1;

        vm.startPrank(admin);
        risk.setValidityBounds(1 minutes, hardMax);

        vm.expectRevert(abi.encodeWithSelector(RiskEngine.InvalidValidityBounds.selector, uint64(1 minutes), tooLong));
        risk.setValidityBounds(1 minutes, tooLong);
        vm.stopPrank();
    }

    function test_RevertWhen_NonAttesterSubmits() public {
        uint64 blocking = _blockingSeverities();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, attesterRole)
        );
        risk.submitAttestation(intentSubject, blocking, 1 ether, 1 hours);
    }

    // --------------------------------------------------------------------------------------
    // Durable metric
    // --------------------------------------------------------------------------------------

    /// @dev The prevented-loss figure has to survive as an event. It is emitted when the BLOCK is
    ///      recorded, because the enforcement path itself reverts and would roll any event back.
    function test_BlockEmitsDurableMetricEvent() public {
        uint64 blocking = _blockingSeverities();

        vm.expectEmit(true, true, true, true, address(risk));
        emit RiskBlocked(intentSubject, admin, 42 ether, 7500, blocking);

        vm.prank(admin);
        risk.submitAttestation(intentSubject, blocking, 42 ether, 1 hours);
    }

    // --------------------------------------------------------------------------------------
    // Subject separation
    // --------------------------------------------------------------------------------------

    /// @dev Cross-provider / cross-subject reuse: an attestation for one agent must not cover
    ///      another, and an intent attestation must not double as an agent-level one.
    function test_Adversarial_AttestationDoesNotLeakAcrossSubjects() public {
        address otherAgent = makeAddr("otherAgent");
        uint64 blocking = _blockingSeverities();

        vm.prank(admin);
        risk.submitAttestation(agentSubject, blocking, 1 ether, 1 hours);

        vm.expectRevert(
            abi.encodeWithSelector(RiskEngine.AgentBlocked.selector, agentAccount, uint64(block.timestamp + 1 hours))
        );
        _enforce();

        // The other agent is untouched.
        risk.enforceIntent(otherAgent, target, 1 ether, SELECTOR, DATA_HASH);

        assertTrue(agentSubject != intentSubject, "agent and intent subjects must not collide");
    }

    /// @dev Domain separation by chain id: the same tuple yields a different subject after a fork.
    function test_SubjectsAreChainSeparated() public {
        vm.chainId(block.chainid + 1);
        bytes32 onOtherChain = risk.intentSubject(agentAccount, target, 1 ether, SELECTOR, DATA_HASH);
        assertTrue(intentSubject != onOtherChain, "subject must change with chain id");
    }

    // --------------------------------------------------------------------------------------
    // Modes
    // --------------------------------------------------------------------------------------

    function test_RestrictedModeRequiresAnAttestation() public {
        uint64 clear = _clearSeverities();

        vm.prank(admin);
        risk.setMode(IRiskEngine.Mode.RESTRICTED);

        vm.expectRevert(
            abi.encodeWithSelector(
                RiskEngine.AttestationRequired.selector, IRiskEngine.Mode.RESTRICTED, uint256(1 ether), uint256(0)
            )
        );
        _enforce();

        vm.prank(admin);
        risk.submitAttestation(intentSubject, clear, 0, 1 hours);
        _enforce();
    }

    function test_CrisisModeRejectsWarn() public {
        uint64 warn = _warnSeverities();

        vm.startPrank(admin);
        risk.submitAttestation(intentSubject, warn, 0, 1 hours);
        risk.setMode(IRiskEngine.Mode.CRISIS);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(RiskEngine.WarnNotPermittedInMode.selector, IRiskEngine.Mode.CRISIS));
        _enforce();
    }

    function test_EscalationIsImmediate_DeEscalationIsDelayed() public {
        vm.prank(admin);
        risk.setMode(IRiskEngine.Mode.CRISIS);

        uint64 allowedAt = risk.modeChangedAt() + risk.deEscalationDelay();

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(RiskEngine.DeEscalationTooSoon.selector, allowedAt));
        risk.setMode(IRiskEngine.Mode.NORMAL);

        vm.warp(block.timestamp + 6 hours);
        vm.prank(admin);
        risk.setMode(IRiskEngine.Mode.NORMAL);
        assertEq(uint8(risk.mode()), uint8(IRiskEngine.Mode.NORMAL));
    }

    function test_RevertWhen_NonGuardianEscalates() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, guardianRole)
        );
        risk.setMode(IRiskEngine.Mode.CRISIS);
    }

    // --------------------------------------------------------------------------------------
    // Denylist
    // --------------------------------------------------------------------------------------

    function test_DenylistBlocksRegardlessOfAttestation() public {
        uint64 clear = _clearSeverities();

        vm.startPrank(admin);
        risk.submitAttestation(intentSubject, clear, 0, 1 hours);
        risk.setDenylisted(target, true);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(RiskEngine.TargetDenylisted.selector, target));
        _enforce();
    }

    // --------------------------------------------------------------------------------------
    // Fuzz
    // --------------------------------------------------------------------------------------

    /// @dev Builds a well-formed severity word from raw fuzz input.
    ///      Rejecting malformed words instead would waste almost every run: a random uint64 has
    ///      all eight bytes <= 100 with probability (101/256)^8, roughly 6 runs in 10,000.
    function _boundSeverities(uint8[8] memory raw) private pure returns (uint64 packed) {
        for (uint256 i = 0; i < 8; ++i) {
            // `% 101` already bounds the value to 0..100, so both casts widen.
            // forge-lint: disable-next-line(unsafe-typecast)
            packed |= uint64(uint8(raw[i] % 101)) << uint64(i * 8);
        }
    }

    /// @dev The scoring invariant: score is always in range and the verdict always matches the
    ///      thresholds unless a mandatory vector forced a block.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_ScoreAndVerdictAreConsistent(uint8[8] memory raw) public view {
        uint64 severities = _boundSeverities(raw);

        (uint8 verdict, uint16 score) = risk.evaluate(severities);
        assertLe(score, 10_000, "score out of range");

        uint8 mask = risk.mandatoryMask();
        bool mandatoryHit;
        for (uint256 i = 0; i < 8; ++i) {
            // Truncation is intended: this reads byte i of the packed severity word.
            // forge-lint: disable-next-line(unsafe-typecast)
            if (uint8(severities >> (i * 8)) == 100 && ((mask >> i) & 1) != 0) mandatoryHit = true;
        }

        if (mandatoryHit || score >= risk.blockThresholdBps()) {
            assertEq(verdict, uint8(IRiskEngine.Verdict.BLOCK));
        } else if (score >= risk.warnThresholdBps()) {
            assertEq(verdict, uint8(IRiskEngine.Verdict.WARN));
        } else {
            assertEq(verdict, uint8(IRiskEngine.Verdict.CLEAR));
        }
    }

    /// @dev The central TADE property, over arbitrary re-attestation sequences: while a BLOCK is
    ///      in window, nothing an attester can submit makes the subject executable.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_BlockSurvivesArbitraryResubmission(uint8[8] memory raw, uint64 validity, uint256 warpBy) public {
        uint64 severities = _boundSeverities(raw);

        uint64 minValidity = risk.minValidity();
        uint64 maxValidity = risk.maxValidity();
        uint64 blocking = _blockingSeverities();

        vm.prank(admin);
        risk.submitAttestation(intentSubject, blocking, 1 ether, 12 hours);
        uint64 blockExpiry = uint64(block.timestamp) + 12 hours;

        validity = uint64(bound(validity, minValidity, maxValidity));
        vm.warp(block.timestamp + bound(warpBy, 0, 11 hours));

        vm.prank(admin);
        try risk.submitAttestation(intentSubject, severities, 0, validity) {
            // Accepted only if it did not weaken the block.
            RiskEngine.Attestation memory att = risk.attestationOf(intentSubject);
            assertEq(att.verdict, uint8(IRiskEngine.Verdict.BLOCK), "accepted a non-block over a live block");
            assertGe(att.expiresAt, blockExpiry, "accepted a shorter window over a live block");
        } catch {
            // Rejected, which is also fine.
        }

        vm.expectRevert();
        _enforce();
    }
}
