/* GEBRID Enterprise OS — Russian interface layer for the browser edition.
 * Translates rendered text after the UI draws it, so application logic and the API stay untouched.
 *
 * Copy style: modern Russian B2B software. Product module names stay in English (Agent Firewall, Guardian,
 * MCP Shield, Continuity Vault), the way Russian SaaS products name their modules; navigation, buttons and
 * messages are short, plain Russian. System identifiers (invoice.draft, finance-agent, INV-1002, audit event
 * types) are kept as-is.
 */
(function (root) {
  'use strict';

  const STATUS = {
    EXECUTED: 'ВЫПОЛНЕНО', DENIED: 'ЗАБЛОКИРОВАНО', REJECTED: 'ОТКЛОНЕНО', PENDING_APPROVAL: 'НА СОГЛАСОВАНИИ', 'PENDING APPROVAL': 'НА СОГЛАСОВАНИИ',
    STALE_POLICY: 'ПОЛИТИКА ИЗМЕНИЛАСЬ', 'STALE POLICY': 'ПОЛИТИКА ИЗМЕНИЛАСЬ', APPLIED: 'ПРИМЕНЕНО', UNCHANGED: 'БЕЗ ИЗМЕНЕНИЙ',
    WAITING_APPROVAL: 'ЖДЁТ СОГЛАСОВАНИЯ', 'WAITING APPROVAL': 'ЖДЁТ СОГЛАСОВАНИЯ', BLOCKED: 'ОСТАНОВЛЕН', COMPLETED: 'ЗАВЕРШЁН',
    SIMULATED: 'СИМУЛЯЦИЯ',
  };
  const ROLE = { admin: 'администратор ИБ', operator: 'оператор', approver: 'финансовый контролёр', auditor: 'аудитор' };
  const USER = { admin: 'администратор ИБ', operator: 'оператор', finance: 'финансовый контролёр', auditor: 'аудитор' };
  const KIND = { Sandbox: 'песочница', Local: 'локальный', Quarantined: 'карантин' };
  const DEPT = { Finance: 'Финансы', Procurement: 'Закупки', Legal: 'Юристы', Engineering: 'Разработка', Operations: 'Операции' };

  // Backend decisions and errors; also reused inside composite toasts.
  const MESSAGES = {
    'All active controls passed': 'Все проверки пройдены',
    'Independent finance approval required': 'Нужно согласование финансового контролёра',
    'Agent does not have this scope': 'У агента нет такого права',
    'Agent is stopped': 'Агент остановлен',
    'No active allowing policy (fail closed)': 'Нет разрешающей политики — по умолчанию запрет',
    'Amount exceeds policy hard limit': 'Сумма выше лимита',
    'Duplicate invoice draft or pending approval exists': 'По этому счёту уже есть черновик или запрос на согласование',
    'Global emergency stop is active': 'Включён аварийный стоп',
    'Guardian detected dangerous input. Action blocked.': 'Guardian нашёл опасный ввод — действие заблокировано',
    'Insufficient remaining agent budget': 'У агента не хватает бюджета',
    'Invoice not found': 'Счёт не найден',
    'Invoice supplier and requested recipient mismatch': 'Получатель не совпадает с поставщиком из счёта',
    'MCP Shield: action not in tool allowlist': 'MCP Shield: инструменту это действие не разрешено',
    'MCP Shield: caller cannot substitute a tool': 'MCP Shield: подменить инструмент нельзя',
    'MCP Shield: required tool is disabled or quarantined': 'MCP Shield: инструмент отключён или в карантине',
    'Purchase amount is required to enforce hard limits and budget': 'Укажите сумму закупки — без неё не проверить лимит и бюджет',
    'Recipient not on trusted policy allowlist': 'Получателя нет в списке доверенных',
    'Requested amount must match trusted invoice record': 'Сумма не совпадает с суммой в счёте',
    'Trusted supplier bank mismatch — cannot be overridden by approval': 'Реквизиты не совпадают с доверенными — согласование это не отменит',
    'Unknown agent': 'Неизвестный агент',
    'Untrusted invoice text contains a prompt injection indicator': 'В тексте счёта найдена prompt injection',
    'Authorization: Bearer token required': 'Войдите в систему',
    'Bearer token required': 'Войдите в систему',
    'Invalid credentials': 'Неверный логин или пароль',
    'Session expired or unauthorized': 'Сессия истекла — войдите снова',
    'Proposer cannot approve own policy change': 'Нельзя согласовать собственное изменение',
    'Requester cannot approve own request': 'Нельзя согласовать собственный запрос',
    'Action not found': 'Запрос не найден', 'Agent not found': 'Агент не найден', 'Policy change not found': 'Изменение не найдено',
    'Policy not found': 'Политика не найдена', 'Tool not found': 'Инструмент не найден', 'Workflow not found': 'Сценарий не найден',
    'Emergency stop blocks migrations': 'Во время аварийного стопа миграция недоступна',
    'Idempotency key reused for different payload': 'Этот ключ идемпотентности уже использован для другого запроса',
    'Latest memory snapshot integrity verification failed': 'Последний снимок памяти не прошёл проверку целостности',
    'Policy change is not pending': 'Это изменение уже рассмотрено',
    'Request is not pending': 'Этот запрос уже рассмотрен',
    'Stopped agents cannot migrate': 'Остановленного агента мигрировать нельзя',
    'A hard amount cap is mandatory for money-moving actions': 'Для операций с деньгами лимит обязателен',
    'A recipient allowlist is mandatory for money-moving actions': 'Для операций с деньгами нужен список доверенных получателей',
    'Choose at least one retained scope': 'Оставьте хотя бы одно право',
    'Duplicate scopes are not allowed': 'Права не должны повторяться',
    'Invalid amount range': 'Сумма вне допустимого диапазона', 'Invalid amount': 'Некорректная сумма', 'Invalid recipient': 'Некорректный получатель',
    'Maximum snapshot state is 8 KiB in this demo': 'В демо снимок не больше 8 КБ',
    'Privilege escalation blocked: new scopes must be a subset': 'Расширить права при миграции нельзя — только сохранить или сузить',
    'Supply at least one field': 'Ничего не изменено',
    'retained_permissions: list of 1-50 scopes': 'Оставьте от 1 до 50 прав',
    'state: must be a JSON object': 'Снимок должен быть JSON-объектом',
    'approve: must be true or false': 'Не указано решение',
    'enabled: must be true or false': 'Не указано, включено ли правило',
    'allowed_recipients: list of at most 40': 'Не больше 40 получателей',
    'Policy changed since proposal; propose again against the current version': 'Политику изменили после предложения — предложите изменение заново',
    'Policy changed; resubmit action for fresh approval': 'Политику изменили — отправьте запрос заново',
    'Externally visible or privileged output; manual approval is required by policy': 'Результат уходит наружу или затрагивает привилегии — нужно ручное согласование',
    'High-value operation; verify approval threshold': 'Крупная сумма — проверьте порог согласования',
    'Possible prompt injection or data exfiltration instruction': 'Похоже на prompt injection или попытку вывести данные',
    'Recipient may point to an external destination': 'Получатель может быть внешним адресом',
    'Approved and executed in local sandbox': 'Согласовано и выполнено в песочнице',
    'Rejected by independent approver': 'Отклонено контролёром',
    'Approved by independent approver': 'Согласовано контролёром',
    'Independent demo finance approval': 'Согласовано финансовым контролёром',
    'Rejected by finance approver': 'Отклонено финансовым контролёром',
    'Snapshot must be valid JSON': 'Снимок должен быть корректным JSON',
    'Snapshot must be a JSON object': 'Снимок должен быть JSON-объектом',
    'recipient allowlist removed': 'удалён список доверенных получателей',
    'policy enabled (grants an allow/approval path)': 'политика включена и открывает путь к исполнению',
  };

  const EXACT = Object.assign({}, MESSAGES, STATUS, {
    // shell and navigation
    'WORKSPACE': 'ОСНОВНОЕ', 'SECURITY & ACTIONS': 'КОНТРОЛЬ', 'CONTINUITY & TRUST': 'НАДЁЖНОСТЬ',
    'Overview': 'Обзор', 'Agent Registry': 'Агенты', 'Agent Firewall': 'Agent Firewall', 'Guardian Controls': 'Guardian',
    'Invoice Control Lab': 'Демо: счета', 'MCP Shield': 'MCP Shield', 'Approvals': 'Согласования', 'Orchestrator': 'Оркестрация',
    'Memory & Migration': 'Память и миграция', 'Audit Trail': 'Аудит', 'System Settings': 'Настройки',
    '◉ ENFORCEMENT ONLINE': '◉ КОНТРОЛЬ АКТИВЕН', '⛔ GLOBAL STOP': '⛔ АВАРИЙНЫЙ СТОП', 'SANDBOX · NOT PRODUCTION': 'ДЕМО-СРЕДА · НЕ ДЛЯ ПРОДАКШНА',
    'Reset demo': 'Сбросить демо', 'Click again to reset': 'Нажмите ещё раз', 'Refresh': 'Обновить', 'Sign out': 'Выйти',
    'SIMULATION ACTIVE': 'ДЕМО-РЕЖИМ', 'No token • No external calls': 'Без токенов и внешних вызовов', 'Policy-first operating system': 'Сначала политика, потом действие',
    'Security control response': 'Готово', 'Request failed': 'Не выполнено', 'Data refreshed': 'Данные обновлены',
    'Demo data reset to the initial state': 'Демо сброшено к исходному состоянию',
    // login
    'Enterprise Agent Security & Continuity': 'Безопасность ИИ-агентов для бизнеса',
    'Autonomy needs': 'Автономии нужны', 'boundaries.': 'границы.',
    'A single control plane for agent identity, permissions, Guardian checks, tool admission, approval workflows and verifiable local audit.':
      'Одна система для контроля ИИ-агентов: учётные записи и права, проверки Guardian, допуск инструментов, согласования и проверяемый аудит.',
    'Permission enforcement before every action': 'Проверка прав перед каждым действием',
    'Independent approvals and emergency stop': 'Независимые согласования и аварийный стоп',
    'Model-independent agent continuity': 'Агент переживает смену модели',
    'Zero tokens. Zero wallets. Zero bank transfers.': 'Без токенов, кошельков и банковских переводов.',
    'BROWSER SANDBOX / v0.1.1': 'ДЕМО В БРАУЗЕРЕ · v0.1.1', 'Access control plane': 'Вход в GEBRID',
    'Sign in using a deliberately synthetic demo identity.': 'Выберите демо-роль. Все данные синтетические.',
    'Email': 'Email', 'Password': 'Пароль', 'Sign in to GEBRID →': 'Войти →', 'SELECT A DEMO ROLE': 'ДЕМО-РОЛИ',
    'Security Admin': 'Администратор ИБ', 'Agent Operator': 'Оператор', 'Finance Approver': 'Финансовый контролёр',
    'Read-only Auditor': 'Аудитор', 'Use credentials ↗': 'Выбрать ↗',
    'Five-minute walkthrough': 'Что посмотреть за 5 минут',
    '→ Invoice Control Lab → submit all five invoices. One drafts, one waits for approval, three are blocked.':
      '→ «Демо: счета» → отправьте все пять счетов. Один пройдёт, один уйдёт на согласование, три система заблокирует.',
    '→ Approvals → approve INV-1002. Policy, tool and budget are rechecked first.':
      '→ «Согласования» → согласуйте INV-1002. Перед выполнением система ещё раз проверит политику, инструмент и бюджет.',
    '→ Agent Firewall → raise the approval threshold. The change waits for the approver; removing the hard cap is refused.':
      '→ Agent Firewall → поднимите порог согласования. Изменение вступит в силу только после контролёра, а убрать лимит совсем система не даст.',
    '→ System Settings → emergency stop, then Agent Registry, MCP Shield and Memory & Migration.':
      '→ «Настройки» → аварийный стоп. Затем «Агенты», MCP Shield и «Память и миграция».',
    '→ Audit Trail → verify the signed event chain.': '→ «Аудит» → проверьте подписанную цепочку событий.',
    'Everything runs inside your browser: synthetic data, demo identities, no network calls, no payments, no AI model calls. Your sandbox is private to this browser; use Reset demo to start over.':
      'Всё работает прямо в браузере: синтетические данные, никаких сетевых запросов, платежей и обращений к ИИ-моделям. Ваше демо видно только вам; «Сбросить демо» вернёт всё к началу.',
    'Independent enforcement · Local-only HMAC audit · No external AI or ERP connections': 'Независимый контроль · Локальный аудит с HMAC · Без внешних ИИ и ERP',
    // overview
    '◉ OPERATIONAL TRUST LAYER': '◉ СЛОЙ ДОВЕРИЯ ДЛЯ ИИ-АГЕНТОВ', 'Secure execution.': 'Безопасное исполнение.', 'Continuous control.': 'Постоянный контроль.',
    'One policy boundary for every AI agent, every tool call and every critical decision. Enterprise control without crypto infrastructure.':
      'Единые правила для всех ИИ-агентов: каждый вызов инструмента и каждое важное решение проходят проверку. Корпоративный контроль без блокчейна и криптовалют.',
    'Try invoice controls': 'Попробовать на счетах', 'Inspect policies': 'Посмотреть политики',
    'Active agents': 'Активные агенты', 'Identity-bound': 'С привязкой к ID', 'registry': 'в реестре',
    'Security policies': 'Политики', 'Fail-closed': 'Запрет', 'by default': 'по умолчанию',
    'Blocked actions': 'Заблокировано', 'High-risk execution denied': 'Рискованные действия остановлены',
    'Pending approvals': 'На согласовании', 'Independent finance review': 'Ждут финансового контролёра',
    'Security decision pipeline': 'Как принимается решение', 'Enforced on the server, not via agent prompts': 'Проверка идёт на сервере, а не в промпте агента',
    'Input Guard': 'Фильтр ввода', 'Permissions': 'Права', 'Approval': 'Согласование', 'Sandbox': 'Исполнение',
    'All operations are local. Banking transfers, live LLM calls and external integrations are disabled.':
      'Всё выполняется локально. Банковские переводы, обращения к LLM и внешние интеграции отключены.',
    'Policy decisions · last 7 days': 'Решения за 7 дней', 'Total and denied control requests': 'Все запросы и заблокированные',
    'Requests': 'Запросы', 'Denied': 'Заблокировано', 'Recent enforcement activity': 'Последние решения',
    'Recorded control-plane requests': 'Запросы агентов', 'Signed event history': 'Подписанная история событий',
    'No actions yet. Run a synthetic invoice scenario to populate the audit flow.': 'Пока пусто. Отправьте демо-счёт — здесь появятся решения.',
    'Time': 'Время', 'Agent': 'Агент', 'Action': 'Действие', 'Decision': 'Решение', 'Status': 'Статус', 'View': 'Открыть',
    'Event': 'Событие', 'Actor': 'Кто', 'Subject': 'Объект', 'Sequence': '№', 'HMAC signature': 'Подпись HMAC',
    // agents
    'Agent OS / identities': 'Реестр агентов',
    'Every agent carries an explicit identity, scoped rights, budget and stoppable runtime state.':
      'У каждого агента свой ID, ограниченные права и бюджет. Любого агента можно остановить.',
    'Review firewall': 'Открыть Agent Firewall', 'Identity active': 'ID активен', 'Current model:': 'Модель:', 'Runtime version:': 'Версия:',
    'Budget used:': 'Потрачено бюджета:', 'No monetary budget': 'Без денежного бюджета', 'View continuity': 'Память и миграция',
    'Stop agent': 'Остановить', 'Resume agent': 'Запустить', 'Identity:': 'ID:',
    'Invoice validation and controlled drafting': 'Проверяет счета и готовит черновики',
    'Supplier-controlled purchasing sandbox': 'Закупки только у проверенных поставщиков',
    'Draft contracts without autonomous signature': 'Готовит договоры, но не подписывает их',
    'Restricted repository assistant': 'Работает с репозиторием в ограниченном режиме',
    'Multi-agent reporting workflow': 'Собирает отчёты вместе с другими агентами',
    'Zero-trust assumption: agent permissions are read from the server registry on every request. A model cannot grant itself a missing scope.':
      'Zero trust: права агента берутся из серверного реестра при каждом запросе. Модель не может выдать себе недостающее право.',
    // firewall
    'Policy engine / runtime': 'Политики и их исполнение',
    'Formal enforcement rules control tool invocations, amount caps, recipients and human approval.':
      'Формальные правила задают, какие инструменты можно вызывать, лимиты сумм, получателей и когда нужен человек.',
    'Launch Guardian test': 'Проверить Guardian', 'Enforceable rules': 'Правила', 'Denied by default when no rule matches': 'Нет подходящего правила — запрет',
    'Policy / action': 'Политика / действие', 'Effect': 'Режим', 'Amount cap': 'Лимит', 'Approval above': 'Согласование от',
    'Limit / allowlist': 'Лимит / получатели', 'Version': 'Версия', 'Controls': 'Действия', 'Edit': 'Изменить', 'Tool': 'Инструмент',
    'Important: policy changes affect simulated actions only. In production, policies require change-control review, enterprise IAM and tested enforcement adapters.':
      'В демо изменения политик влияют только на симулированные действия. В продакшне к этому добавляются процесс согласования изменений, корпоративный IAM и проверенные интеграции.',
    'Enforcement effect': 'Режим', 'Rule enabled': 'Правило', 'Enabled': 'Включено', 'Disabled': 'Выключено',
    'Hard amount cap (USD)': 'Лимит суммы, $', 'Approval above (USD)': 'Согласование от суммы, $',
    'Trusted recipients (comma-separated)': 'Доверенные получатели (через запятую)',
    'Every edit increments policy version. Prior approvals with a stale version are rejected on recheck.':
      'Любое изменение повышает версию политики. Согласования, выданные по старой версии, перестают действовать.',
    'Cancel': 'Отмена', 'No policy fields changed': 'Ничего не изменилось',
    'Agent scopes and mandatory approval are checked on each request.': 'Права агента и обязательное согласование проверяются на каждом запросе.',
    'Input Guard → Intent → Policy → Allowlist → Approval': 'Фильтр ввода → Намерение → Политика → Разрешённые действия → Согласование',
    // guardian
    'Guardian / deterministic analysis': 'Guardian · проверка по правилам', 'Guardian Security': 'Guardian',
    'Intent inspection for a controlled execution path. This demo uses explicit rules, not a second LLM.':
      'Проверяет, что агент собирается сделать, до исполнения. В демо работают правила, а не вторая LLM.',
    'Inspect proposed agent output': 'Проверить ответ агента', 'Load a test string and run the deterministic filter.': 'Подставьте пример и запустите проверку.',
    'Requested action': 'Действие', 'Untrusted input / tool response': 'Текст для проверки (ввод или ответ инструмента)',
    'Recipient (optional)': 'Получатель (необязательно)', 'Amount (optional)': 'Сумма (необязательно)', 'Run Guardian assessment →': 'Проверить →',
    'Injection test': 'Prompt injection', 'Safe message': 'Обычный текст', 'Credential leak': 'Вывод секретов',
    'Assessment result': 'Результат', 'Mode: deterministic-demo-rules': 'Режим: демо-правила',
    'Guardian deterministic check completed': 'Проверка Guardian завершена',
    'No matching heuristic indicator. This is not proof that the content is safe.': 'Совпадений с правилами нет. Это ещё не гарантия, что текст безопасен.',
    'What Guardian enforces': 'Что проверяет Guardian', 'Heuristic prompt injection filter': 'Фильтр prompt injection',
    'Detects some obvious instruction override and credential-leak patterns. Not exhaustive.': 'Ловит явные попытки переписать инструкции или вытащить секреты. Не всё.',
    'Formal Policy Engine': 'Движок политик', 'Independent limits, scopes and recipient allowlists; no LLM can override them.': 'Лимиты, права и списки получателей, которые LLM не может обойти.',
    'Human approval checkpoint': 'Согласование человеком', 'Financial approval must come from a different account and session.': 'Финансовое согласование даёт другой человек под своей учётной записью.',
    'Future target: independent dual-LLM Guardian. It is NOT integrated into this sandbox.': 'В планах: независимая проверка второй LLM. В демо её пока нет.',
    'high': 'высокий', 'medium': 'средний', 'low': 'низкий',
    // invoices
    'Finance / synthetic workflow': 'Финансы · демо-сценарий',
    'Five controlled test cases: draft, independent approval, bank mismatch, hard-limit breach and prompt injection.':
      'Пять счетов — пять ситуаций: обычный счёт, крупная сумма, подменённые реквизиты, превышение лимита и prompt injection.',
    'Approval queue': 'К согласованиям', 'Synthetic invoices': 'Демо-счета', 'No customer data or secrets': 'Без реальных данных',
    'Drafts created': 'Черновики', 'Local records · no bank transfers': 'Только записи, без переводов',
    'Untrusted input cases': 'Попытки атак', 'Negative security demonstrations': 'Система должна их остановить',
    'Invoice sandbox data': 'Счета', 'Server-side supplier verification · invoice amount is immutable for this demo': 'Поставщик проверяется на сервере · сумму счёта изменить нельзя',
    'sandbox': 'демо', 'Invoice / scenario': 'Счёт', 'Supplier': 'Поставщик', 'Amount': 'Сумма', 'Submitted bank': 'Реквизиты в счёте',
    'Integrity': 'Реквизиты', 'Guardian input': 'Текст счёта', 'Submit draft': 'Отправить',
    'MATCH': 'СОВПАДАЮТ', 'MISMATCH': 'ПОДМЕНЕНЫ', 'CLEAR': 'ЧИСТО', 'SUSPICIOUS': 'ПОДОЗРИТЕЛЬНО',
    'Server equipment': 'Серверное оборудование', 'Logistics services': 'Логистика', 'Tampered bank details': 'Подменённые реквизиты',
    'Over-limit invoice': 'Сумма выше лимита', 'Suspicious tool output': 'Вредоносный текст в счёте',
    'Execution boundaries': 'Что проверяется', 'Formal checks': 'Формальные правила',
    'Active agent, allowed scope, approved MCP tool, amount limit, trusted supplier, Guardian filter.': 'Агент активен, у него есть право, инструмент допущен, сумма в лимите, поставщик проверен, Guardian не возражает.',
    'Human approval above $5,000': 'От $5 000 — согласование человеком',
    'Finance approver must explicitly accept the pending action. Requester cannot self-approve.': 'Финансовый контролёр подтверждает операцию. Автор запроса сам себе согласовать не может.',
    'Simulated ERP draft only': 'Только черновик в ERP', 'Writes a local draft record. No banking API or payment call is available.': 'Создаётся только черновик. Доступа к банку и платежам нет.',
    'Role walkthrough': 'Как пройти сценарий', 'Use the agent operator account to submit': 'Под оператором отправьте', '. It waits for approval.': '. Счёт уйдёт на согласование.',
    'Sign out, log in as': 'Затем войдите как', ', open Approvals, then approve or reject. The policy and budget are rechecked.': ', откройте «Согласования» и примите решение. Политика и бюджет проверятся ещё раз.',
    'Repeat submissions do not create duplicate drafts. Rejections may be resubmitted after correction.': 'Повторная отправка не создаёт дубль. Отклонённый счёт можно отправить снова после исправления.',
    'Execution receipt': 'Результат', 'Request': 'Запрос', 'Resource': 'Объект', 'Guardian risk': 'Риск (Guardian)', 'Policy version': 'Версия политики',
    'Sandbox execution metadata': 'Детали исполнения', 'Close': 'Закрыть',
    '@title:Only the operator role proposes actions': '@title:Отправлять запросы может только оператор',
    // tools
    'MCP admission / tool boundary': 'Допуск инструментов', 'Allowlisted tool calls, sandbox endpoints and quarantine status before execution.': 'Какие инструменты агенты могут вызывать, а какие в карантине.',
    'ALLOWED ACTIONS': 'РАЗРЕШЕНО', 'Disable tool': 'Отключить', 'Admit tool': 'Допустить', 'Tool admitted': 'Допущен',
    'The tool registry contains no real secrets or tokens. "Admit" updates only the local registry; no third-party MCP server is contacted.':
      'В реестре нет настоящих ключей и токенов. «Допустить» меняет только локальный реестр — к внешним MCP-серверам система не обращается.',
    'Only creates synthetic drafts; no bank access': 'Создаёт только черновики, к банку доступа нет', 'Demo-only purchase order records': 'Демо-заказы на закупку',
    'Dummy contracts and approval gates': 'Демо-договоры с обязательным согласованием', 'Simulated pull requests, no GitHub credentials': 'Демо pull request, без доступа к GitHub',
    'Synthetic reports, no external publishing': 'Демо-отчёты, без публикации наружу', 'Blocked third-party server': 'Сторонний сервер, заблокирован',
    'ERP Draft Adapter': 'ERP: черновики', 'Purchase Adapter': 'Закупки', 'Document Vault': 'Хранилище документов', 'Git Connector': 'Git',
    'Reports Adapter': 'Отчёты', 'Untrusted External MCP': 'Внешний MCP без доверия',
    // approvals
    'Human-in-the-loop governance': 'Решения за человеком', 'Approval Center': 'Согласования',
    'Segregation of duties: operators request actions, a finance approver authorizes or rejects.': 'Разделение ролей: оператор отправляет запрос, финансовый контролёр согласует или отклоняет.',
    'New scenario': 'Новый счёт', 'Pending approval': 'На согласовании', 'Finance approver required': 'Ждут контролёра',
    'Executed drafts': 'Черновики', 'DRAFT ONLY · no money movement': 'Только черновики, деньги не двигаются', 'Recorded requests': 'Всего запросов',
    'Latest 100 local requests': 'Последние 100', 'Finance approval queue': 'Ждут решения',
    'Approval rechecks runtime policies and available budget': 'При согласовании политика и бюджет проверяются заново',
    'No requests need approval. Try invoice INV-1002 ($9,800).': 'Согласовывать нечего. Отправьте счёт INV-1002 ($9 800).',
    'Approve': 'Согласовать', 'Reject': 'Отклонить', 'approver only': 'решает контролёр',
    'Policy change queue': 'Изменения политик', 'Relaxing a limit needs an independent approver; stricter changes apply at once': 'Ужесточение применяется сразу, ослабление — только после контролёра',
    'No relaxing policy changes are waiting for review.': 'Изменений на согласовании нет.',
    'All action requests': 'Все запросы', 'Denied, approved, pending and simulated executions': 'Заблокированные, согласованные, ожидающие и выполненные',
    'Created ERP drafts': 'Черновики в ERP', 'No payment API, bank integration or externally signed orders': 'Без платежей и банковских интеграций',
    'No sandbox drafts have been created yet.': 'Черновиков пока нет.', 'Draft ID': 'Черновик', 'Invoice': 'Счёт', 'Execution': 'Исполнение',
    'DRAFT ONLY': 'ЧЕРНОВИК',
    // workflows
    'Agent Orchestrator': 'Оркестрация агентов', 'Multi-agent execution': 'Несколько агентов в одном процессе',
    'Sequential workflow engine with per-step policy checks. Permissions are never pooled across agents.': 'Агенты работают по шагам, и каждый шаг проходит проверку. Права разных агентов не складываются.',
    'Controlled invoice processing': 'Обработка счёта', 'Finance intake → reporting review → controlled ERP draft': 'Приём счёта → сводка → черновик в ERP',
    'Legal document handoff': 'Отправка договора', 'Contract review → manual approval → simulated delivery': 'Проверка договора → согласование → отправка (демо)',
    'Invoice reference': 'Счёт', 'Document reference (synthetic)': 'Документ (демо)', 'Run controlled workflow →': 'Запустить →',
    'Latest execution trace': 'Последний запуск', 'Prior workflow runs': 'История запусков', 'No multi-agent workflows have been run.': 'Запусков пока не было.',
    'Steps': 'Шаги', 'Workflow': 'Сценарий', 'Created': 'Когда', 'Run': 'Запуск', 'Only the fixture-adapter workflows are available': 'В демо доступны два готовых сценария',
    // continuity
    'Memory integrity / model switch': 'Память агента и смена модели', 'Continuity Vault': 'Continuity Vault',
    'HMAC-signed snapshots, unchanged identity, preserved budget and non-escalating permissions.': 'Подписанные снимки памяти. При смене модели ID, бюджет и права агента не меняются.',
    'Create integrity snapshot': 'Сохранить снимок', 'Snapshot JSON (synthetic; never use real secrets)': 'JSON снимка (только демо-данные)',
    'State blob is signed with the local HMAC key and verified before migration. Max 8 KiB.': 'Снимок подписывается ключом HMAC и проверяется перед миграцией. До 8 КБ.',
    'Save signed checkpoint': 'Сохранить и подписать', 'Recent snapshots': 'Снимки', 'No snapshots yet (or your role cannot read them).': 'Снимков нет или они недоступны вашей роли.',
    'Controlled model migration': 'Смена модели', 'Demo adapter switches preserve budgets and prevent permission escalation.': 'Бюджет сохраняется, расширить права нельзя.',
    'New simulated model': 'Новая модель (демо)', 'Retained scopes · subset only': 'Какие права оставить (только из текущих)', 'Verify & migrate →': 'Проверить и перенести →',
    'Continuity invariants': 'Что гарантируется', 'Agent ID remains unchanged': 'ID агента не меняется', 'Used budget never resets': 'Потраченный бюджет не обнуляется',
    'New scopes ⊆ old scopes': 'Новые права ⊆ старые', 'Snapshot HMAC must verify': 'Подпись снимка должна сойтись', 'Every migration is recorded': 'Каждая миграция попадает в аудит',
    'Migration history': 'История миграций', 'No migration attempts yet.': 'Миграций пока не было.', 'Model': 'Модель', 'Migration': 'Миграция',
    'Simulate migration': 'Перенести агента', 'Retain or narrow existing scopes. New scopes must be denied.': 'Права можно сохранить или сузить, но не расширить.',
    'This demo migrates metadata between simulated model adapters. It does not migrate a production autonomous agent’s hidden LLM state or external credentials.':
      'В демо переносятся только метаданные между условными моделями. Внутреннее состояние LLM и внешние ключи настоящего агента не переносятся.',
    'Identity continuity': 'ID сохраняется', 'Permission preservation': 'Права не расширяются', 'Budget continuity': 'Бюджет сохраняется', 'Memory integrity': 'Память не подменена',
    'Snapshot integrity · Scope subset': 'Подпись снимка · Права не шире прежних', 'Scopes retained': 'Права сохранены',
    // audit
    'Audit / restricted': 'Аудит · доступ ограничен', 'This section requires an auditor or security admin identity.': 'Раздел доступен аудитору и администратору ИБ.',
    'Switch to the auditor demo account to inspect verifiable evidence.': 'Войдите как аудитор, чтобы посмотреть журнал.',
    'Integrity / event trace': 'Журнал событий', 'Verifiable Audit Trail': 'Аудит',
    'Local HMAC-linked events for requests, policy changes, approvals and migrations.': 'Все запросы, изменения политик, согласования и миграции. Записи связаны подписью HMAC — подмену видно.',
    'Verify chain integrity': 'Проверить целостность', 'Recorded events': 'Событий', 'Latest 100 locally signed events': 'Последние 100',
    'Chain verification': 'Проверка цепочки', 'HMAC hash-chain only': 'Цепочка подписей HMAC', 'Independent anchor': 'Внешняя фиксация',
    'External write-once store is not installed': 'Внешнее неизменяемое хранилище не подключено', 'VALID': 'ЦЕЛА', 'NOT RUN': 'НЕ ПРОВЕРЯЛАСЬ', 'NOT SET': 'НЕТ',
    'Local chain and snapshots verified': 'Цепочка и снимки целы', 'Integrity verification failed': 'Обнаружена подмена',
    'Tamper checks work locally. External anchoring is not implemented.': 'Подмену видно локально. Внешней фиксации пока нет.',
    'Verify local chain': 'Проверить цепочку', 'Audit lineage': 'История', 'Evidence': 'Доказательства', 'EVIDENCE': 'ДОКАЗАТЕЛЬСТВА',
    'Recorded': 'Записано',
    // settings
    'Trust boundaries / operations': 'Управление и ограничения', 'Emergency response controls and explicit prototype readiness disclosures.': 'Аварийный стоп и честная карта того, что уже работает.',
    'Global Emergency Stop': 'Аварийный стоп', 'Applies to all agents and workflows': 'Для всех агентов и сценариев',
    'When enabled, no new agent-controlled actions can execute. Pending approvals are also blocked on recheck; migration is disabled.':
      'Пока стоп включён, агенты ничего не выполняют. Ожидающие согласования не пройдут повторную проверку, миграция недоступна.',
    'NOMINAL': 'ШТАТНО', 'STOP ACTIVE': 'СТОП ВКЛЮЧЁН', 'Activate emergency stop': 'Включить аварийный стоп', 'Release global stop': 'Снять аварийный стоп',
    'The system is in emergency lockdown.': 'Система остановлена.', 'No emergency stop is active. Every request still passes policy enforcement.': 'Стоп не включён. Каждый запрос по-прежнему проходит проверку политик.',
    'Only security admins may change emergency state.': 'Включать и снимать стоп может только администратор ИБ.',
    'Global emergency stop activated': 'Аварийный стоп включён', 'Global emergency stop released': 'Аварийный стоп снят',
    'Security roles': 'Роли', 'Policy, admission, agent status, emergency stop': 'Политики, допуск инструментов, агенты, аварийный стоп',
    'Submit sandbox work and run workflows': 'Отправляет запросы и запускает сценарии', 'Independent finance approval only': 'Только финансовое согласование',
    'Read audit, inspect snapshot digests': 'Смотрит аудит и подписи снимков',
    'Prototype readiness matrix': 'Готовность прототипа', 'Documented scope based on 05 Nov 2026 Enterprise concept, not production claims.': 'По концепции Enterprise от 05.11.2026. Это прототип, а не продукт для продакшна.',
    'Policy evaluation': 'Проверка политик', 'Agent registry / stop': 'Реестр и остановка агентов', 'Invoice draft / approval': 'Черновики и согласования',
    'MCP tool allowlist': 'Допуск MCP-инструментов', 'HMAC snapshots / migrations': 'Снимки и миграции', 'Independent Guardian LLM': 'Guardian на второй LLM',
    'ERP, CRM and bank APIs': 'Интеграции с ERP, CRM, банками', 'Enterprise IAM / SSO': 'Корпоративный SSO', 'External immutable audit': 'Внешний неизменяемый аудит',
    'Multi-tenant isolation / HA': 'Мультитенантность и отказоустойчивость', 'Penetration testing / security audit': 'Пентест и аудит безопасности',
    'Working in local demo': 'Работает в демо', 'Simulated adapter switch': 'Симуляция', 'Not integrated': 'Нет',
    'Not implemented': 'Нет', 'Not performed': 'Не проводился', 'NOT READY': 'НЕ ГОТОВО',
    'DEMO ONLY: synthetic credentials, single tenant, local SQLite, fixed tool adapters. Do not expose to the Internet or connect real customers without production hardening and an independent security assessment.':
      'Это демо: синтетические учётные записи, один клиент, локальное хранилище, фиксированные интеграции. Реальных клиентов подключать только после доработки и независимого аудита безопасности.',
    'Technical trust boundary': 'Ограничение', 'Local integrity is not independently tamper-proof if both database and key are compromised': 'Если у злоумышленника и база, и ключ, локальный аудит подмену не покажет',
    'Source: GEBRID Enterprise OS concept, 05 Nov 2026': 'Источник: концепция GEBRID Enterprise OS, 05.11.2026',
    // tags, cards, misc
    'active': 'активен', 'stopped': 'остановлен', 'disabled': 'отключён', 'quarantined': 'в карантине',
    'allow': 'разрешено', 'approval': 'с согласованием', 'deny': 'запрещено',
    'LOCAL': 'ЛОКАЛЬНО', 'CONTINUITY': 'ПЕРЕНОС', 'INDEPENDENT CONTROLS': 'НЕЗАВИСИМЫЙ КОНТРОЛЬ',
    'Attack demonstrations': 'Атаки', 'Demo security scenarios': 'Демо-сценарии', 'Try positive and negative controls': 'Что пропустит система, а что остановит',
    'Authorized draft': 'Обычный счёт', 'Finance approval': 'Нужен контролёр', 'Bank mismatch': 'Подмена реквизитов', 'Hard-limit breach': 'Выше лимита',
    'Prompt injection': 'Prompt injection', '$4,200 · trusted recipient · auto-executes': '$4 200 · проверенный поставщик · пройдёт сразу',
    '$9,800 · above approval threshold': '$9 800 · нужно согласование', 'Untrusted supplier account · denied': 'Чужие реквизиты · блок',
    '$35,000 · exceeds policy limit': '$35 000 · выше лимита · блок', 'Malicious invoice text · denied': 'Инъекция в тексте счёта · блок',
    'Policy versions invalidate stale approvals': 'Изменили политику — старые согласования не действуют', 'Identity · Policy · Enforcement': 'ID · Политика · Контроль',
    'Agent identity': 'ID агента', 'Scope authorized': 'Право есть', 'Sandbox execution': 'Исполнение',
    'server-side': 'на сервере', 'global': 'все', 'Version 1 · valid': 'Версия 1 · подпись верна',
    'All actions': 'Все действия', 'Budget': 'Бюджет', 'Control request': 'Запрос', 'HMAC-linked local audit': 'Аудит с подписью HMAC',
    'admin': 'администратор ИБ', 'operator': 'оператор', 'approver': 'контролёр', 'auditor': 'аудитор', 'finance': 'контролёр',
    '@placeholder:Empty = no allowlist': '@placeholder:Пусто — без ограничений', '@placeholder:No amount cap': '@placeholder:Без лимита',
    '@placeholder:No threshold': '@placeholder:Без порога', '@placeholder:Paste a test instruction or suspicious document...': '@placeholder:Вставьте текст для проверки…',
  });

  const tm = s => (s in MESSAGES ? MESSAGES[s] : s);
  const tStatus = s => STATUS[s] || s;
  const money = s => s.replace(/(\d),(\d{3})/g, '$1 $2');
  function weak(s) {
    let m;
    if ((m = /^(max_amount|approval_above) relaxed: (.+) -> (.+)$/.exec(s))) return `${m[1] === 'max_amount' ? 'лимит' : 'порог согласования'}: ${m[2]} → ${m[3] === 'null' ? 'без ограничения' : m[3]}`;
    if ((m = /^effect relaxed: (\w+) -> (\w+)$/.exec(s))) return `режим: ${EXACT[m[1]] || m[1]} → ${EXACT[m[2]] || m[2]}`;
    if ((m = /^recipients added: (.+)$/.exec(s))) return 'новые получатели: ' + m[1];
    return tm(s);
  }
  const model = s => s.replace(/ · simulated$/, ' · демо');
  const PATTERNS = [
    [/^Signed in as (\w+)$/, m => 'Вы вошли как ' + (ROLE[m[1]] || m[1])],
    [/^Policy updated to v(\d+); pending approvals will be rechecked$/, m => `Политика обновлена (v${m[1]}). Старые согласования больше не действуют`],
    [/^Relaxing change sent for independent approval: (.+)$/, m => 'Ослабление ушло на согласование контролёру — ' + m[1].split('; ').map(weak).join('; ')],
    [/^(max_amount|approval_above) relaxed: .+$|^effect relaxed: .+$|^recipients added: .+$/, m => m[0].split(' · ').map(weak).join(' · ')],
    [/^Policy change (\w+) · (.+)$/, m => `Изменение политики: ${tStatus(m[1]).toLowerCase()} · ${tm(m[2])}`],
    [/^([A-Z]+-\d+): (\w+) · (.+)$/, m => `${m[1]}: ${tStatus(m[2]).toLowerCase()} · ${tm(m[3])}`],
    [/^(EXECUTED|DENIED|REJECTED|STALE_POLICY|PENDING_APPROVAL|APPLIED) · (.+)$/, m => `${tStatus(m[1])} · ${m[2].startsWith('Recheck failed: ') ? 'повторная проверка не пройдена: ' + tm(m[2].slice(16)) : tm(m[2])}`],
    [/^Recheck failed: (.+)$/, m => 'Повторная проверка не пройдена: ' + tm(m[1])],
    [/^Agent: (.+) · (.+) · Proposed by (.+)$/, m => `${m[1]} · ${money(m[2])} · отправил ${USER[m[3]] || m[3]}`],
    [/^Proposed by (.+) · (.+)$/, m => `Предложил ${USER[m[1]] || m[1]} · ${m[2]}`],
    [/^Workflow: (\w+)$/, m => 'Сценарий: ' + tStatus(m[1]).toLowerCase()],
    [/^Workflow (WF-\S+) ·$/, m => `Сценарий ${m[1]} ·`],
    [/^Signed snapshot (\S+) · v(\d+)$/, m => `Снимок сохранён и подписан · v${m[2]}`],
    [/^Simulated migration succeeded; (\d+) scopes retained$/, m => `Агент перенесён на новую модель. Прав сохранено: ${m[1]}`],
    [/^✓ Local chain validated\. Checked (\d+) events and (\d+) snapshots\. .*$/, m => `✓ Подмены нет. Проверено событий: ${m[1]}, снимков: ${m[2]}. Проверка локальная: у кого есть и данные этого браузера, и ключ, тот может переписать журнал.`],
    [/^✕ (.+)$/, m => '✕ ' + tm(m[1])],
    [/^Save policy v(\d+)$/, m => `Сохранить (v${m[1]})`],
    [/^Edit policy: (.+)$/, m => 'Политика ' + m[1]],
    [/^Version (\d+) · valid$/, m => `Версия ${m[1]} · подпись верна`],
    [/^Version (\d+) · invalid$/, m => `Версия ${m[1]} · ПОДПИСЬ НЕ СХОДИТСЯ`],
    [/^Permissions v(\d+)$/, m => 'Права v' + m[1]],
    [/^Agent status updated to (\w+)$/, m => m[1] === 'stopped' ? 'Агент остановлен' : 'Агент снова работает'],
    [/^MCP admission changed: (\w+)$/, m => m[1] === 'active' ? 'Инструмент допущен' : (m[1] === 'disabled' ? 'Инструмент отключён' : 'Инструмент в карантине')],
    [/^Requires one of roles: (.+)$/, m => 'Недоступно для вашей роли. Нужна роль: ' + m[1].split(', ').map(r => ROLE[r] || r).join(' или ')],
    [/^Local API is unreachable: (.+)$/, m => 'Демо не отвечает: ' + m[1]],
    [/^· (.+)$/, m => '· ' + tr(m[1])],
    [/^(.+) · (AR-[0-9A-F]+)$/, m => `${tm(m[1])} · ${m[2]}`],
    [/^(.+) · independent scope evaluation$/, m => m[1] + ' · права проверяются отдельно'],
    [/^(\S+) · (Sandbox|Local|Quarantined)$/, m => `${m[1]} · ${KIND[m[2]]}`],
    [/^(Finance|Procurement|Legal|Engineering|Operations) · (.+)$/, m => `${DEPT[m[1]]} · ${model(m[2])}`],
    [/^(.+ · simulated) → (.+ · simulated)$/, m => `${model(m[1])} → ${model(m[2])}`],
    [/^(.+) · simulated$/, m => m[1] + ' · демо'],
    [/^(INV-\d+) · (\$[\d,]+)$/, m => `${m[1]} · ${money(m[2])}`],
  ];

  function tr(s) {
    if (Object.prototype.hasOwnProperty.call(EXACT, s)) return EXACT[s];
    for (const [re, fn] of PATTERNS) { const m = re.exec(s); if (m) return fn(m); }
    return s;
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const skipped = el => { for (let e = el; e; e = e.parentElement) { if (SKIP.has(e.tagName) || (e.classList && (e.classList.contains('code-area') || e.classList.contains('no-i18n')))) return true; } return false; };
  function translateText(node) {
    const raw = node.textContent, t = raw.trim();
    if (!t || !/[A-Za-z]/.test(t) || skipped(node.parentElement)) return;
    const out = tr(t);
    if (out !== t) node.textContent = raw.replace(t, out);
  }
  function translateAttrs(el) {
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const key = '@' + a + ':' + v;
      if (EXACT[key]) el.setAttribute(a, EXACT[key].slice(a.length + 2));
    }
  }
  function walk(n) {
    if (n.nodeType === 3) return translateText(n);
    if (n.nodeType !== 1) return;
    translateAttrs(n);
    if (SKIP.has(n.tagName)) return;
    n.childNodes.forEach(walk);
  }

  let lang = 'en', observer = null;
  function start(doc) {
    observer = new MutationObserver(ms => {
      if (lang !== 'ru') return;
      for (const m of ms) {
        if (m.type === 'characterData') translateText(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(doc, { childList: true, subtree: true, characterData: true });
  }
  function setLang(l, doc) {
    lang = l === 'ru' ? 'ru' : 'en';
    doc.documentElement.lang = lang;
    if (lang === 'ru') walk(doc.body);
  }

  const api = { tr, start, setLang, get lang() { return lang; }, EXACT, PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GebridI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
