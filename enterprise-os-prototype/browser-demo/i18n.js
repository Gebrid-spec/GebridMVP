/* GEBRID Enterprise OS — Russian interface layer for the browser edition.
 * Translates rendered text after the UI draws it, so application logic and the API stay untouched.
 * System identifiers (invoice.draft, finance-agent, INV-1002, audit event types) are kept as-is.
 */
(function (root) {
  'use strict';

  const STATUS = {
    EXECUTED: 'ИСПОЛНЕНО', DENIED: 'ЗАПРЕЩЕНО', REJECTED: 'ОТКЛОНЕНО', PENDING_APPROVAL: 'НА СОГЛАСОВАНИИ', 'PENDING APPROVAL': 'НА СОГЛАСОВАНИИ',
    STALE_POLICY: 'ПОЛИТИКА УСТАРЕЛА', 'STALE POLICY': 'ПОЛИТИКА УСТАРЕЛА', APPLIED: 'ПРИМЕНЕНО', UNCHANGED: 'БЕЗ ИЗМЕНЕНИЙ',
    WAITING_APPROVAL: 'ЖДЁТ СОГЛАСОВАНИЯ', 'WAITING APPROVAL': 'ЖДЁТ СОГЛАСОВАНИЯ', BLOCKED: 'ЗАБЛОКИРОВАН', COMPLETED: 'ЗАВЕРШЁН',
    SIMULATED: 'СИМУЛЯЦИЯ',
  };
  const ROLE = { admin: 'администратор безопасности', operator: 'оператор', approver: 'финансовый согласующий', auditor: 'аудитор' };
  const KIND = { Sandbox: 'песочница', Local: 'локальный', Quarantined: 'карантин' };
  const DEPT = { Finance: 'Финансы', Procurement: 'Закупки', Legal: 'Юристы', Engineering: 'Разработка', Operations: 'Операции' };

  // Backend decisions and errors; also used for substring replacement inside composite messages.
  const MESSAGES = {
    'All active controls passed': 'Все активные проверки пройдены',
    'Independent finance approval required': 'Требуется независимое финансовое согласование',
    'Agent does not have this scope': 'У агента нет этого права',
    'Agent is stopped': 'Агент остановлен',
    'No active allowing policy (fail closed)': 'Нет активной разрешающей политики (по умолчанию запрет)',
    'Amount exceeds policy hard limit': 'Сумма превышает жёсткий лимит политики',
    'Duplicate invoice draft or pending approval exists': 'Черновик или запрос на согласование по этому счёту уже существует',
    'Global emergency stop is active': 'Действует глобальная аварийная остановка',
    'Guardian detected dangerous input. Action blocked.': 'Guardian обнаружил опасный ввод. Действие заблокировано.',
    'Insufficient remaining agent budget': 'Недостаточно оставшегося бюджета агента',
    'Invoice not found': 'Счёт не найден',
    'Invoice supplier and requested recipient mismatch': 'Получатель не совпадает с поставщиком в счёте',
    'MCP Shield: action not in tool allowlist': 'MCP Shield: действие не разрешено для инструмента',
    'MCP Shield: caller cannot substitute a tool': 'MCP Shield: подменить инструмент нельзя',
    'MCP Shield: required tool is disabled or quarantined': 'MCP Shield: нужный инструмент отключён или на карантине',
    'Purchase amount is required to enforce hard limits and budget': 'Для закупки нужна сумма, иначе нельзя проверить лимит и бюджет',
    'Recipient not on trusted policy allowlist': 'Получателя нет в доверенном списке политики',
    'Requested amount must match trusted invoice record': 'Сумма должна совпадать с суммой в доверенной записи счёта',
    'Trusted supplier bank mismatch — cannot be overridden by approval': 'Банковские реквизиты не совпадают с доверенным справочником — согласование это не обходит',
    'Unknown agent': 'Неизвестный агент',
    'Untrusted invoice text contains a prompt injection indicator': 'В недоверенном тексте счёта есть признак prompt injection',
    'Authorization: Bearer token required': 'Нужна авторизация',
    'Bearer token required': 'Нужна авторизация',
    'Invalid credentials': 'Неверный логин или пароль',
    'Session expired or unauthorized': 'Сессия истекла, войдите снова',
    'Proposer cannot approve own policy change': 'Автор изменения не может сам его одобрить',
    'Requester cannot approve own request': 'Автор запроса не может сам его одобрить',
    'Action not found': 'Запрос не найден', 'Agent not found': 'Агент не найден', 'Policy change not found': 'Изменение политики не найдено',
    'Policy not found': 'Политика не найдена', 'Tool not found': 'Инструмент не найден', 'Workflow not found': 'Сценарий не найден',
    'Emergency stop blocks migrations': 'Аварийная остановка блокирует миграции',
    'Idempotency key reused for different payload': 'Ключ идемпотентности уже использован для другого запроса',
    'Latest memory snapshot integrity verification failed': 'Последний снимок памяти не прошёл проверку целостности',
    'Policy change is not pending': 'Изменение политики уже рассмотрено',
    'Request is not pending': 'Запрос уже рассмотрен',
    'Stopped agents cannot migrate': 'Остановленного агента нельзя мигрировать',
    'A hard amount cap is mandatory for money-moving actions': 'Для денежных действий жёсткий лимит суммы обязателен',
    'A recipient allowlist is mandatory for money-moving actions': 'Для денежных действий список доверенных получателей обязателен',
    'Choose at least one retained scope': 'Оставьте хотя бы одно право',
    'Duplicate scopes are not allowed': 'Права не должны повторяться',
    'Invalid amount range': 'Сумма вне допустимого диапазона', 'Invalid amount': 'Неверная сумма', 'Invalid recipient': 'Неверный получатель',
    'Maximum snapshot state is 8 KiB in this demo': 'Снимок в демо не больше 8 КиБ',
    'Privilege escalation blocked: new scopes must be a subset': 'Повышение привилегий заблокировано: новые права должны быть подмножеством старых',
    'Supply at least one field': 'Измените хотя бы одно поле',
    'retained_permissions: list of 1-50 scopes': 'Оставьте от 1 до 50 прав',
    'state: must be a JSON object': 'Снимок должен быть JSON-объектом',
    'approve: must be true or false': 'Решение должно быть «да» или «нет»',
    'enabled: must be true or false': 'Поле «включено» должно быть «да» или «нет»',
    'allowed_recipients: list of at most 40': 'Не больше 40 получателей',
    'Policy changed since proposal; propose again against the current version': 'Политика изменилась после предложения; предложите изменение заново к текущей версии',
    'Policy changed; resubmit action for fresh approval': 'Политика изменилась; подайте запрос заново для нового согласования',
    'Externally visible or privileged output; manual approval is required by policy': 'Внешний или привилегированный результат; политика требует ручного согласования',
    'High-value operation; verify approval threshold': 'Крупная операция; проверьте порог согласования',
    'Possible prompt injection or data exfiltration instruction': 'Возможная prompt injection или команда на вывод данных',
    'Recipient may point to an external destination': 'Получатель может указывать на внешний адрес',
    'Approved and executed in local sandbox': 'Одобрено и исполнено в локальной песочнице',
    'Rejected by independent approver': 'Отклонено независимым согласующим',
    'Approved by independent approver': 'Одобрено независимым согласующим',
    'Independent demo finance approval': 'Независимое финансовое согласование (демо)',
    'Rejected by finance approver': 'Отклонено финансовым согласующим',
    'Snapshot must be valid JSON': 'Снимок должен быть корректным JSON',
    'Snapshot must be a JSON object': 'Снимок должен быть JSON-объектом',
    'recipient allowlist removed': 'удалён список доверенных получателей',
    'policy enabled (grants an allow/approval path)': 'политика включена (открывает путь к исполнению)',
  };

  const EXACT = Object.assign({}, MESSAGES, {
    // shell and navigation
    'WORKSPACE': 'РАБОЧЕЕ ПРОСТРАНСТВО', 'SECURITY & ACTIONS': 'БЕЗОПАСНОСТЬ И ДЕЙСТВИЯ', 'CONTINUITY & TRUST': 'НЕПРЕРЫВНОСТЬ И ДОВЕРИЕ',
    'Overview': 'Обзор', 'Agent Registry': 'Реестр агентов', 'Agent Firewall': 'Файрвол агентов', 'Guardian Controls': 'Guardian',
    'Invoice Control Lab': 'Лаборатория счетов', 'MCP Shield': 'MCP Shield', 'Approvals': 'Согласования', 'Orchestrator': 'Оркестратор',
    'Memory & Migration': 'Память и миграция', 'Audit Trail': 'Журнал аудита', 'System Settings': 'Настройки системы',
    'Enterprise OS': 'Enterprise OS', 'ENTERPRISE OS': 'ENTERPRISE OS',
    '◉ ENFORCEMENT ONLINE': '◉ КОНТРОЛЬ ВКЛЮЧЁН', '⛔ GLOBAL STOP': '⛔ ГЛОБАЛЬНАЯ ОСТАНОВКА', 'SANDBOX · NOT PRODUCTION': 'ПЕСОЧНИЦА · НЕ БОЕВАЯ СРЕДА',
    'Reset demo': 'Сбросить демо', 'Click again to reset': 'Нажмите ещё раз для сброса', 'Refresh': 'Обновить', 'Sign out': 'Выйти',
    'SIMULATION ACTIVE': 'РЕЖИМ СИМУЛЯЦИИ', 'No token • No external calls': 'Без токенов • Без внешних вызовов', 'Policy-first operating system': 'Операционная система, где политика первична',
    'Security control response': 'Ответ контроля безопасности', 'Request failed': 'Запрос отклонён', 'Data refreshed': 'Данные обновлены',
    'Demo data reset to the initial state': 'Демо-данные сброшены в исходное состояние',
    // login
    'Enterprise Agent Security & Continuity': 'Безопасность и непрерывность корпоративных агентов',
    'Autonomy needs': 'Автономии нужны', 'boundaries.': 'границы.',
    'A single control plane for agent identity, permissions, Guardian checks, tool admission, approval workflows and verifiable local audit.':
      'Единый контур управления: идентичность агентов, права, проверки Guardian, допуск инструментов, согласования и проверяемый локальный аудит.',
    'Permission enforcement before every action': 'Проверка прав перед каждым действием',
    'Independent approvals and emergency stop': 'Независимые согласования и аварийная остановка',
    'Model-independent agent continuity': 'Непрерывность агента независимо от модели',
    'Zero tokens. Zero wallets. Zero bank transfers.': 'Ни токенов, ни кошельков, ни банковских переводов.',
    'BROWSER SANDBOX / v0.1.1': 'ПЕСОЧНИЦА В БРАУЗЕРЕ / v0.1.1', 'Access control plane': 'Вход в контур управления',
    'Sign in using a deliberately synthetic demo identity.': 'Войдите под одной из синтетических демо-учётных записей.',
    'Email': 'Email', 'Password': 'Пароль', 'Sign in to GEBRID →': 'Войти в GEBRID →', 'SELECT A DEMO ROLE': 'ВЫБЕРИТЕ ДЕМО-РОЛЬ',
    'Security Admin': 'Администратор безопасности', 'Agent Operator': 'Оператор агентов', 'Finance Approver': 'Финансовый согласующий',
    'Read-only Auditor': 'Аудитор (только чтение)', 'Use credentials ↗': 'Подставить данные ↗',
    'Five-minute walkthrough': 'Маршрут на пять минут',
    '→ Invoice Control Lab → submit all five invoices. One drafts, one waits for approval, three are blocked.':
      '→ Лаборатория счетов → отправьте все пять счетов. Один станет черновиком, один уйдёт на согласование, три будут заблокированы.',
    '→ Approvals → approve INV-1002. Policy, tool and budget are rechecked first.':
      '→ Согласования → одобрите INV-1002. Перед исполнением политика, инструмент и бюджет проверяются заново.',
    '→ Agent Firewall → raise the approval threshold. The change waits for the approver; removing the hard cap is refused.':
      '→ Файрвол агентов → поднимите порог согласования. Изменение ждёт согласующего, а снять жёсткий лимит система не даст.',
    '→ System Settings → emergency stop, then Agent Registry, MCP Shield and Memory & Migration.':
      '→ Настройки системы → аварийная остановка, затем Реестр агентов, MCP Shield и Память и миграция.',
    '→ Audit Trail → verify the signed event chain.': '→ Журнал аудита → проверьте подписанную цепочку событий.',
    'Everything runs inside your browser: synthetic data, demo identities, no network calls, no payments, no AI model calls. Your sandbox is private to this browser; use Reset demo to start over.':
      'Всё работает внутри вашего браузера: синтетические данные, демо-учётки, без сетевых запросов, платежей и вызовов ИИ. Песочница видна только в этом браузере; «Сбросить демо» возвращает исходное состояние.',
    'Independent enforcement · Local-only HMAC audit · No external AI or ERP connections': 'Независимый контроль · Локальный HMAC-аудит · Без внешних ИИ и ERP',
    // overview
    '◉ OPERATIONAL TRUST LAYER': '◉ СЛОЙ ОПЕРАЦИОННОГО ДОВЕРИЯ', 'Secure execution.': 'Безопасное исполнение.', 'Continuous control.': 'Непрерывный контроль.',
    'One policy boundary for every AI agent, every tool call and every critical decision. Enterprise control without crypto infrastructure.':
      'Единая граница политик для каждого ИИ-агента, каждого вызова инструмента и каждого критичного решения. Корпоративный контроль без крипто-инфраструктуры.',
    'Try invoice controls': 'Проверить контроль счетов', 'Inspect policies': 'Открыть политики',
    'Active agents': 'Активные агенты', 'Identity-bound': 'Привязаны к идентичности', 'registry': 'в реестре',
    'Security policies': 'Политики безопасности', 'Fail-closed': 'Запрет', 'by default': 'по умолчанию',
    'Blocked actions': 'Заблокированные действия', 'High-risk execution denied': 'Рискованное исполнение запрещено',
    'Pending approvals': 'Ожидают согласования', 'Independent finance review': 'Независимая финансовая проверка',
    'Security decision pipeline': 'Конвейер решений безопасности', 'Enforced on the server, not via agent prompts': 'Применяется на сервере, а не через промпты агента',
    'Input Guard': 'Проверка ввода', 'Permissions': 'Права', 'Approval': 'Согласование', 'Sandbox': 'Песочница',
    'All operations are local. Banking transfers, live LLM calls and external integrations are disabled.':
      'Все операции локальные. Банковские переводы, живые вызовы LLM и внешние интеграции отключены.',
    'Policy decisions · last 7 days': 'Решения политик · последние 7 дней', 'Total and denied control requests': 'Всего запросов и запрещённых',
    'Requests': 'Запросы', 'Denied': 'Запрещено', 'Recent enforcement activity': 'Последние решения контроля',
    'Recorded control-plane requests': 'Записанные запросы к контуру управления', 'Signed event history': 'Подписанная история событий',
    'No actions yet. Run a synthetic invoice scenario to populate the audit flow.': 'Действий пока нет. Запустите сценарий со счётом, чтобы появились записи.',
    'Time': 'Время', 'Agent': 'Агент', 'Action': 'Действие', 'Decision': 'Решение', 'Status': 'Статус', 'View': 'Открыть',
    'Event': 'Событие', 'Actor': 'Исполнитель', 'Subject': 'Объект', 'Sequence': 'Номер', 'HMAC signature': 'HMAC-подпись',
    // agents
    'Agent OS / identities': 'Агенты / идентичности',
    'Every agent carries an explicit identity, scoped rights, budget and stoppable runtime state.':
      'У каждого агента явная идентичность, ограниченные права, бюджет и состояние, которое можно остановить.',
    'Review firewall': 'Открыть файрвол', 'Identity active': 'Идентичность активна', 'Current model:': 'Текущая модель:', 'Runtime version:': 'Версия:',
    'Budget used:': 'Израсходовано бюджета:', 'No monetary budget': 'Без денежного бюджета', 'View continuity': 'Непрерывность',
    'Stop agent': 'Остановить агента', 'Resume agent': 'Возобновить агента', 'Identity:': 'Идентичность:',
    'Invoice validation and controlled drafting': 'Проверка счетов и контролируемое создание черновиков',
    'Supplier-controlled purchasing sandbox': 'Песочница закупок с контролем поставщиков',
    'Draft contracts without autonomous signature': 'Черновики договоров без автономной подписи',
    'Restricted repository assistant': 'Ассистент репозитория с ограниченными правами',
    'Multi-agent reporting workflow': 'Многоагентная подготовка отчётов',
    'Zero-trust assumption: agent permissions are read from the server registry on every request. A model cannot grant itself a missing scope.':
      'Принцип zero trust: права агента читаются из серверного реестра при каждом запросе. Модель не может выдать себе недостающее право.',
    // firewall
    'Policy engine / runtime': 'Движок политик / исполнение',
    'Formal enforcement rules control tool invocations, amount caps, recipients and human approval.':
      'Формальные правила управляют вызовами инструментов, лимитами сумм, получателями и согласованием человеком.',
    'Launch Guardian test': 'Запустить тест Guardian', 'Enforceable rules': 'Исполняемые правила', 'Denied by default when no rule matches': 'Если правило не найдено — запрет',
    'Policy / action': 'Политика / действие', 'Effect': 'Эффект', 'Amount cap': 'Лимит суммы', 'Approval above': 'Согласование выше',
    'Limit / allowlist': 'Лимит / получатели', 'Version': 'Версия', 'Controls': 'Управление', 'Edit': 'Изменить', 'Tool': 'Инструмент',
    'Important: policy changes affect simulated actions only. In production, policies require change-control review, enterprise IAM and tested enforcement adapters.':
      'Важно: изменения политик влияют только на симулированные действия. В боевой среде нужны процесс контроля изменений, корпоративный IAM и проверенные адаптеры исполнения.',
    'Enforcement effect': 'Эффект правила', 'Rule enabled': 'Правило включено', 'Enabled': 'Включено', 'Disabled': 'Отключено',
    'Hard amount cap (USD)': 'Жёсткий лимит суммы (USD)', 'Approval above (USD)': 'Согласование при сумме выше (USD)',
    'Trusted recipients (comma-separated)': 'Доверенные получатели (через запятую)',
    'Every edit increments policy version. Prior approvals with a stale version are rejected on recheck.':
      'Каждое изменение повышает версию политики. Согласования, выданные по старой версии, отклоняются при повторной проверке.',
    'Cancel': 'Отмена', 'No policy fields changed': 'Поля политики не изменились',
    'Agent scopes and mandatory approval are checked on each request.': 'Права агента и обязательное согласование проверяются при каждом запросе.',
    'Input Guard → Intent → Policy → Allowlist → Approval': 'Проверка ввода → Намерение → Политика → Список разрешённого → Согласование',
    // guardian
    'Guardian / deterministic analysis': 'Guardian / детерминированный анализ', 'Guardian Security': 'Guardian Security',
    'Intent inspection for a controlled execution path. This demo uses explicit rules, not a second LLM.':
      'Проверка намерения перед контролируемым исполнением. В демо используются явные правила, а не вторая LLM.',
    'Inspect proposed agent output': 'Проверить предложенный результат агента', 'Load a test string and run the deterministic filter.': 'Загрузите тестовую строку и запустите детерминированный фильтр.',
    'Requested action': 'Запрошенное действие', 'Untrusted input / tool response': 'Недоверенный ввод / ответ инструмента',
    'Recipient (optional)': 'Получатель (необязательно)', 'Amount (optional)': 'Сумма (необязательно)', 'Run Guardian assessment →': 'Запустить проверку Guardian →',
    'Injection test': 'Тест инъекции', 'Safe message': 'Безопасный текст', 'Credential leak': 'Утечка учётных данных',
    'Assessment result': 'Результат проверки', 'Mode: deterministic-demo-rules': 'Режим: детерминированные демо-правила',
    'Guardian deterministic check completed': 'Детерминированная проверка Guardian завершена',
    'No matching heuristic indicator. This is not proof that the content is safe.': 'Эвристика ничего не нашла. Это не доказательство безопасности текста.',
    'What Guardian enforces': 'Что проверяет Guardian', 'Heuristic prompt injection filter': 'Эвристический фильтр prompt injection',
    'Detects some obvious instruction override and credential-leak patterns. Not exhaustive.': 'Ловит часть явных попыток переписать инструкции и вывести секреты. Не исчерпывающий.',
    'Formal Policy Engine': 'Формальный движок политик', 'Independent limits, scopes and recipient allowlists; no LLM can override them.': 'Независимые лимиты, права и списки получателей; LLM не может их переопределить.',
    'Human approval checkpoint': 'Точка согласования человеком', 'Financial approval must come from a different account and session.': 'Финансовое согласование даёт другая учётная запись в другой сессии.',
    'Future target: independent dual-LLM Guardian. It is NOT integrated into this sandbox.': 'Цель на будущее: независимый Guardian на двух LLM. В эту песочницу он НЕ встроен.',
    'Please draft the invoice using the approved supplier and standard finance policy.': 'Please draft the invoice using the approved supplier and standard finance policy.',
    'high': 'высокий', 'medium': 'средний', 'low': 'низкий',
    // invoices
    'Finance / synthetic workflow': 'Финансы / синтетический процесс',
    'Five controlled test cases: draft, independent approval, bank mismatch, hard-limit breach and prompt injection.':
      'Пять контрольных случаев: черновик, независимое согласование, подмена реквизитов, превышение лимита и prompt injection.',
    'Approval queue': 'Очередь согласований', 'Synthetic invoices': 'Синтетические счета', 'No customer data or secrets': 'Без клиентских данных и секретов',
    'Drafts created': 'Создано черновиков', 'Local records · no bank transfers': 'Локальные записи · без банковских переводов',
    'Untrusted input cases': 'Случаи с недоверенным вводом', 'Negative security demonstrations': 'Демонстрация отказов системы безопасности',
    'Invoice sandbox data': 'Счета в песочнице', 'Server-side supplier verification · invoice amount is immutable for this demo': 'Поставщик проверяется на сервере · сумму счёта в демо изменить нельзя',
    'sandbox': 'песочница', 'Invoice / scenario': 'Счёт / сценарий', 'Supplier': 'Поставщик', 'Amount': 'Сумма', 'Submitted bank': 'Банк в счёте',
    'Integrity': 'Целостность', 'Guardian input': 'Ввод для Guardian', 'Submit draft': 'Создать черновик',
    'MATCH': 'СОВПАДАЕТ', 'MISMATCH': 'НЕ СОВПАДАЕТ', 'CLEAR': 'ЧИСТО', 'SUSPICIOUS': 'ПОДОЗРИТЕЛЬНО',
    'Server equipment': 'Серверное оборудование', 'Logistics services': 'Логистические услуги', 'Tampered bank details': 'Подменённые реквизиты',
    'Over-limit invoice': 'Счёт сверх лимита', 'Suspicious tool output': 'Подозрительный вывод инструмента',
    'Execution boundaries': 'Границы исполнения', 'Formal checks': 'Формальные проверки',
    'Active agent, allowed scope, approved MCP tool, amount limit, trusted supplier, Guardian filter.': 'Активный агент, разрешённое право, допущенный MCP-инструмент, лимит суммы, доверенный поставщик, фильтр Guardian.',
    'Human approval above $5,000': 'Согласование человеком выше $5,000',
    'Finance approver must explicitly accept the pending action. Requester cannot self-approve.': 'Финансовый согласующий должен явно принять действие. Автор запроса не может одобрить его сам.',
    'Simulated ERP draft only': 'Только симулированный черновик в ERP', 'Writes a local draft record. No banking API or payment call is available.': 'Создаётся локальная запись черновика. Банковского API и платежей нет.',
    'Role walkthrough': 'Порядок действий по ролям', 'Use the agent operator account to submit': 'Под учётной записью оператора отправьте', '. It waits for approval.': '. Счёт уйдёт на согласование.',
    'Sign out, log in as': 'Выйдите и войдите как', ', open Approvals, then approve or reject. The policy and budget are rechecked.': ', откройте «Согласования» и одобрите или отклоните. Политика и бюджет проверяются заново.',
    'Repeat submissions do not create duplicate drafts. Rejections may be resubmitted after correction.': 'Повторная отправка не создаёт дубликат черновика. Отклонённое можно подать снова после исправления.',
    'Execution receipt': 'Квитанция исполнения', 'Request': 'Запрос', 'Resource': 'Ресурс', 'Guardian risk': 'Риск по Guardian', 'Policy version': 'Версия политики',
    'Sandbox execution metadata': 'Метаданные исполнения в песочнице', 'Close': 'Закрыть',
    '@title:Only the operator role proposes actions': '@title:Запросы на действия подаёт только оператор',
    // tools
    'MCP admission / tool boundary': 'Допуск MCP / граница инструментов', 'Allowlisted tool calls, sandbox endpoints and quarantine status before execution.': 'Разрешённые вызовы инструментов, песочные endpoints и карантин — до исполнения.',
    'ALLOWED ACTIONS': 'РАЗРЕШЁННЫЕ ДЕЙСТВИЯ', 'Disable tool': 'Отключить инструмент', 'Admit tool': 'Допустить инструмент', 'Tool admitted': 'Инструмент допущен',
    'The tool registry contains no real secrets or tokens. "Admit" updates only the local registry; no third-party MCP server is contacted.':
      'В реестре инструментов нет настоящих секретов и токенов. «Допустить» меняет только локальный реестр; к сторонним MCP-серверам запросов нет.',
    'Only creates synthetic drafts; no bank access': 'Создаёт только синтетические черновики; доступа к банку нет', 'Demo-only purchase order records': 'Демо-записи заказов на закупку',
    'Dummy contracts and approval gates': 'Тестовые договоры и точки согласования', 'Simulated pull requests, no GitHub credentials': 'Симулированные pull request, без доступа к GitHub',
    'Synthetic reports, no external publishing': 'Синтетические отчёты, без внешней публикации', 'Blocked third-party server': 'Заблокированный сторонний сервер',
    'ERP Draft Adapter': 'ERP-адаптер черновиков', 'Purchase Adapter': 'Адаптер закупок', 'Document Vault': 'Хранилище документов', 'Git Connector': 'Git-коннектор',
    'Reports Adapter': 'Адаптер отчётов', 'Untrusted External MCP': 'Недоверенный внешний MCP',
    // approvals
    'Human-in-the-loop governance': 'Управление с участием человека', 'Approval Center': 'Центр согласований',
    'Segregation of duties: operators request actions, a finance approver authorizes or rejects.': 'Разделение обязанностей: оператор запрашивает действие, финансовый согласующий одобряет или отклоняет.',
    'New scenario': 'Новый сценарий', 'Pending approval': 'На согласовании', 'Finance approver required': 'Нужен финансовый согласующий',
    'Executed drafts': 'Исполненные черновики', 'DRAFT ONLY · no money movement': 'ТОЛЬКО ЧЕРНОВИК · деньги не двигаются', 'Recorded requests': 'Записанные запросы',
    'Latest 100 local requests': 'Последние 100 локальных запросов', 'Finance approval queue': 'Очередь финансовых согласований',
    'Approval rechecks runtime policies and available budget': 'При согласовании политики и бюджет проверяются заново',
    'No requests need approval. Try invoice INV-1002 ($9,800).': 'Нет запросов на согласование. Попробуйте счёт INV-1002 ($9,800).',
    'Approve': 'Одобрить', 'Reject': 'Отклонить', 'approver only': 'только согласующий',
    'Policy change queue': 'Очередь изменений политик', 'Relaxing a limit needs an independent approver; stricter changes apply at once': 'Ослабление лимита требует независимого согласующего; ужесточение применяется сразу',
    'No relaxing policy changes are waiting for review.': 'Нет ослаблений политик, ожидающих проверки.',
    'All action requests': 'Все запросы на действия', 'Denied, approved, pending and simulated executions': 'Запрещённые, одобренные, ожидающие и исполненные в симуляции',
    'Created ERP drafts': 'Созданные черновики в ERP', 'No payment API, bank integration or externally signed orders': 'Без платёжного API, банковских интеграций и внешних подписанных поручений',
    'No sandbox drafts have been created yet.': 'Черновиков в песочнице пока нет.', 'Draft ID': 'ID черновика', 'Invoice': 'Счёт', 'Execution': 'Исполнение',
    'DRAFT ONLY': 'ТОЛЬКО ЧЕРНОВИК',
    // workflows
    'Agent Orchestrator': 'Оркестратор агентов', 'Multi-agent execution': 'Многоагентное исполнение',
    'Sequential workflow engine with per-step policy checks. Permissions are never pooled across agents.': 'Последовательные сценарии с проверкой политики на каждом шаге. Права агентов никогда не объединяются.',
    'Controlled invoice processing': 'Контролируемая обработка счёта', 'Finance intake → reporting review → controlled ERP draft': 'Приём в финансах → проверка отчётом → контролируемый черновик в ERP',
    'Legal document handoff': 'Передача юридического документа', 'Contract review → manual approval → simulated delivery': 'Проверка договора → ручное согласование → симулированная отправка',
    'Invoice reference': 'Счёт', 'Document reference (synthetic)': 'Документ (синтетический)', 'Run controlled workflow →': 'Запустить контролируемый сценарий →',
    'Latest execution trace': 'Последний ход исполнения', 'Prior workflow runs': 'Предыдущие запуски', 'No multi-agent workflows have been run.': 'Многоагентные сценарии ещё не запускались.',
    'Steps': 'Шаги', 'Workflow': 'Сценарий', 'Created': 'Создан', 'Run': 'Запуск', 'Only the fixture-adapter workflows are available': 'Доступны только сценарии на тестовых адаптерах',
    // continuity
    'Memory integrity / model switch': 'Целостность памяти / смена модели', 'Continuity Vault': 'Хранилище непрерывности',
    'HMAC-signed snapshots, unchanged identity, preserved budget and non-escalating permissions.': 'Снимки с HMAC-подписью, неизменная идентичность, сохранённый бюджет и права без расширения.',
    'Create integrity snapshot': 'Создать снимок целостности', 'Snapshot JSON (synthetic; never use real secrets)': 'JSON снимка (синтетический; не вставляйте настоящие секреты)',
    'State blob is signed with the local HMAC key and verified before migration. Max 8 KiB.': 'Состояние подписывается локальным HMAC-ключом и проверяется перед миграцией. До 8 КиБ.',
    'Save signed checkpoint': 'Сохранить подписанный снимок', 'Recent snapshots': 'Последние снимки', 'No snapshots yet (or your role cannot read them).': 'Снимков пока нет (или вашей роли они недоступны).',
    'Controlled model migration': 'Контролируемая миграция модели', 'Demo adapter switches preserve budgets and prevent permission escalation.': 'Смена демо-адаптера сохраняет бюджет и не даёт расширить права.',
    'New simulated model': 'Новая симулированная модель', 'Retained scopes · subset only': 'Оставляемые права · только подмножество', 'Verify & migrate →': 'Проверить и мигрировать →',
    'Continuity invariants': 'Инварианты непрерывности', 'Agent ID remains unchanged': 'ID агента не меняется', 'Used budget never resets': 'Израсходованный бюджет не обнуляется',
    'New scopes ⊆ old scopes': 'Новые права ⊆ старые права', 'Snapshot HMAC must verify': 'HMAC снимка должен проходить проверку', 'Every migration is recorded': 'Каждая миграция записывается',
    'Migration history': 'История миграций', 'No migration attempts yet.': 'Миграций пока не было.', 'Model': 'Модель', 'Migration': 'Миграция',
    'Simulate migration': 'Симулировать миграцию', 'Retain or narrow existing scopes. New scopes must be denied.': 'Права можно сохранить или сузить. Новые права запрещены.',
    'This demo migrates metadata between simulated model adapters. It does not migrate a production autonomous agent’s hidden LLM state or external credentials.':
      'Демо переносит метаданные между симулированными адаптерами моделей. Скрытое состояние LLM и внешние учётные данные боевого агента не переносятся.',
    'Identity continuity': 'Непрерывность идентичности', 'Permission preservation': 'Сохранение прав', 'Budget continuity': 'Непрерывность бюджета', 'Memory integrity': 'Целостность памяти',
    'Snapshot integrity · Scope subset': 'Целостность снимка · Подмножество прав', 'Scopes retained': 'Права сохранены',
    // audit
    'Audit / restricted': 'Аудит / ограниченный доступ', 'This section requires an auditor or security admin identity.': 'Этот раздел доступен аудитору или администратору безопасности.',
    'Switch to the auditor demo account to inspect verifiable evidence.': 'Войдите как аудитор, чтобы посмотреть проверяемые доказательства.',
    'Integrity / event trace': 'Целостность / след событий', 'Verifiable Audit Trail': 'Проверяемый журнал аудита',
    'Local HMAC-linked events for requests, policy changes, approvals and migrations.': 'Локальные события, связанные HMAC-цепочкой: запросы, изменения политик, согласования, миграции.',
    'Verify chain integrity': 'Проверить целостность цепочки', 'Recorded events': 'Записанные события', 'Latest 100 locally signed events': 'Последние 100 локально подписанных событий',
    'Chain verification': 'Проверка цепочки', 'HMAC hash-chain only': 'Только HMAC-цепочка', 'Independent anchor': 'Независимый якорь',
    'External write-once store is not installed': 'Внешнее хранилище write-once не подключено', 'VALID': 'ВАЛИДНА', 'NOT RUN': 'НЕ ЗАПУСКАЛАСЬ', 'NOT SET': 'НЕ ЗАДАН',
    'Local chain and snapshots verified': 'Локальная цепочка и снимки проверены', 'Integrity verification failed': 'Проверка целостности не пройдена',
    'Tamper checks work locally. External anchoring is not implemented.': 'Проверка подмены работает локально. Внешняя привязка не реализована.',
    'Verify local chain': 'Проверить локальную цепочку', 'Audit lineage': 'Происхождение записей', 'Evidence': 'Доказательства', 'EVIDENCE': 'ДОКАЗАТЕЛЬСТВА',
    'Recorded': 'Записано',
    // settings
    'Trust boundaries / operations': 'Границы доверия / эксплуатация', 'Emergency response controls and explicit prototype readiness disclosures.': 'Аварийное управление и честная карта готовности прототипа.',
    'Global Emergency Stop': 'Глобальная аварийная остановка', 'Applies to all agents and workflows': 'Действует на всех агентов и сценарии',
    'When enabled, no new agent-controlled actions can execute. Pending approvals are also blocked on recheck; migration is disabled.':
      'Пока включена, новые действия агентов не исполняются. Ожидающие согласования блокируются при повторной проверке; миграция отключена.',
    'NOMINAL': 'НОРМА', 'STOP ACTIVE': 'ОСТАНОВКА ВКЛЮЧЕНА', 'Activate emergency stop': 'Включить аварийную остановку', 'Release global stop': 'Снять глобальную остановку',
    'The system is in emergency lockdown.': 'Система в режиме аварийной блокировки.', 'No emergency stop is active. Every request still passes policy enforcement.': 'Аварийная остановка не включена. Каждый запрос по-прежнему проходит проверку политик.',
    'Only security admins may change emergency state.': 'Менять аварийный режим может только администратор безопасности.',
    'Global emergency stop activated': 'Глобальная аварийная остановка включена', 'Global emergency stop released': 'Глобальная аварийная остановка снята',
    'Security roles': 'Роли безопасности', 'Policy, admission, agent status, emergency stop': 'Политики, допуск инструментов, статус агентов, аварийная остановка',
    'Submit sandbox work and run workflows': 'Подаёт действия в песочнице и запускает сценарии', 'Independent finance approval only': 'Только независимое финансовое согласование',
    'Read audit, inspect snapshot digests': 'Читает аудит и проверяет дайджесты снимков',
    'Prototype readiness matrix': 'Карта готовности прототипа', 'Documented scope based on 05 Nov 2026 Enterprise concept, not production claims.': 'Объём по концепции Enterprise от 05.11.2026; это не заявление о готовности к боевой эксплуатации.',
    'Policy evaluation': 'Проверка политик', 'Agent registry / stop': 'Реестр агентов / остановка', 'Invoice draft / approval': 'Черновик счёта / согласование',
    'MCP tool allowlist': 'Список разрешённых MCP-инструментов', 'HMAC snapshots / migrations': 'HMAC-снимки / миграции', 'Independent Guardian LLM': 'Независимый Guardian на LLM',
    'ERP, CRM and bank APIs': 'API ERP, CRM и банков', 'Enterprise IAM / SSO': 'Корпоративный IAM / SSO', 'External immutable audit': 'Внешний неизменяемый аудит',
    'Multi-tenant isolation / HA': 'Изоляция арендаторов / отказоустойчивость', 'Penetration testing / security audit': 'Пентест / аудит безопасности',
    'Working in local demo': 'Работает в локальном демо', 'Simulated adapter switch': 'Симулированная смена адаптера', 'Not integrated': 'Не интегрирован',
    'Not implemented': 'Не реализовано', 'Not performed': 'Не проводился', 'NOT READY': 'НЕ ГОТОВО',
    'DEMO ONLY: synthetic credentials, single tenant, local SQLite, fixed tool adapters. Do not expose to the Internet or connect real customers without production hardening and an independent security assessment.':
      'ТОЛЬКО ДЕМО: синтетические учётки, один арендатор, локальное хранилище, фиксированные адаптеры. Не подключайте реальных клиентов без доработки для боевой эксплуатации и независимой оценки безопасности.',
    'Technical trust boundary': 'Техническая граница доверия', 'Local integrity is not independently tamper-proof if both database and key are compromised': 'Локальная целостность не защищает от подмены, если скомпрометированы и база, и ключ',
    'Source: GEBRID Enterprise OS concept, 05 Nov 2026': 'Источник: концепция GEBRID Enterprise OS, 05.11.2026',
    // misc tags and labels seen in cards
    'active': 'активен', 'stopped': 'остановлен', 'disabled': 'отключён', 'quarantined': 'карантин',
    'allow': 'разрешить', 'approval': 'согласование', 'deny': 'запретить',
    'BLOCKED': 'ЗАБЛОКИРОВАН', 'LOCAL': 'ЛОКАЛЬНО', 'CONTINUITY': 'НЕПРЕРЫВНОСТЬ', 'INDEPENDENT CONTROLS': 'НЕЗАВИСИМЫЙ КОНТРОЛЬ',
    'Attack demonstrations': 'Демонстрация атак', 'Demo security scenarios': 'Демо-сценарии безопасности', 'Try positive and negative controls': 'Проверьте и разрешения, и отказы',
    'Authorized draft': 'Разрешённый черновик', 'Finance approval': 'Финансовое согласование', 'Bank mismatch': 'Подмена реквизитов', 'Hard-limit breach': 'Превышение лимита',
    'Prompt injection': 'Prompt injection', '$4,200 · trusted recipient · auto-executes': '$4,200 · доверенный получатель · исполняется сразу',
    '$9,800 · above approval threshold': '$9,800 · выше порога согласования', 'Untrusted supplier account · denied': 'Реквизиты недоверенные · запрет',
    '$35,000 · exceeds policy limit': '$35,000 · выше лимита политики', 'Malicious invoice text · denied': 'Вредоносный текст в счёте · запрет',
    'Policy versions invalidate stale approvals': 'Новая версия политики аннулирует старые согласования', 'Identity · Policy · Enforcement': 'Идентичность · Политика · Контроль',
    'Agent identity': 'Идентичность агента', 'Scope authorized': 'Право подтверждено', 'Sandbox execution': 'Исполнение в песочнице',
    'server-side': 'на сервере', 'global': 'глобально', 'Version 1 · valid': 'Версия 1 · валиден',
    '@placeholder:Empty = no allowlist': '@placeholder:Пусто = без списка', '@placeholder:No amount cap': '@placeholder:Без лимита',
    '@placeholder:No threshold': '@placeholder:Без порога', '@placeholder:Paste a test instruction or suspicious document...': '@placeholder:Вставьте тестовую инструкцию или подозрительный документ...',
  });

  Object.assign(EXACT, STATUS, {
    'All actions': 'Все действия', 'Budget': 'Бюджет', 'Control request': 'Запрос к контуру', 'HMAC-linked local audit': 'Локальный аудит с HMAC-цепочкой',
    'admin': 'администратор', 'operator': 'оператор', 'approver': 'согласующий', 'auditor': 'аудитор', 'finance': 'согласующий',
  });
  const USER = { admin: 'администратор', operator: 'оператор', finance: 'согласующий', auditor: 'аудитор' };
  const tm = s => (s in MESSAGES ? MESSAGES[s] : s);
  const tStatus = s => STATUS[s] || s;
  function weak(s) {
    let m;
    if ((m = /^(max_amount|approval_above) relaxed: (.+) -> (.+)$/.exec(s))) return `${m[1] === 'max_amount' ? 'лимит суммы' : 'порог согласования'} ослаблен: ${m[2]} → ${m[3]}`;
    if ((m = /^effect relaxed: (\w+) -> (\w+)$/.exec(s))) return `эффект ослаблен: ${EXACT[m[1]] || m[1]} → ${EXACT[m[2]] || m[2]}`;
    if ((m = /^recipients added: (.+)$/.exec(s))) return 'добавлены получатели: ' + m[1];
    return tm(s);
  }
  const model = s => s.replace(/ · simulated$/, ' · симуляция');
  const PATTERNS = [
    [/^Signed in as (\w+)$/, m => 'Вход выполнен: ' + (ROLE[m[1]] || m[1])],
    [/^Policy updated to v(\d+); pending approvals will be rechecked$/, m => `Политика обновлена до v${m[1]}; ожидающие согласования будут перепроверены`],
    [/^Relaxing change sent for independent approval: (.+)$/, m => 'Ослабление отправлено на независимое согласование: ' + m[1].split('; ').map(weak).join('; ')],
    [/^(max_amount|approval_above) relaxed: .+$|^effect relaxed: .+$|^recipients added: .+$/, m => m[0].split(' · ').map(weak).join(' · ')],
    [/^Policy change (\w+) · (.+)$/, m => `Изменение политики: ${tStatus(m[1])} · ${tm(m[2])}`],
    [/^([A-Z]+-\d+): (\w+) · (.+)$/, m => `${m[1]}: ${tStatus(m[2])} · ${tm(m[3])}`],
    [/^(EXECUTED|DENIED|REJECTED|STALE_POLICY|PENDING_APPROVAL|APPLIED) · (.+)$/, m => `${tStatus(m[1])} · ${m[2].startsWith('Recheck failed: ') ? 'Повторная проверка не пройдена: ' + tm(m[2].slice(16)) : tm(m[2])}`],
    [/^Recheck failed: (.+)$/, m => 'Повторная проверка не пройдена: ' + tm(m[1])],
    [/^Agent: (.+) · (.+) · Proposed by (.+)$/, m => `Агент: ${m[1]} · ${m[2]} · Предложил: ${USER[m[3]] || m[3]}`],
    [/^Proposed by (.+) · (.+)$/, m => `Предложил: ${USER[m[1]] || m[1]} · ${m[2]}`],
    [/^Workflow: (\w+)$/, m => 'Сценарий: ' + tStatus(m[1])],
    [/^Workflow (WF-\S+) ·$/, m => `Сценарий ${m[1]} ·`],
    [/^Signed snapshot (\S+) · v(\d+)$/, m => `Подписанный снимок ${m[1]} · v${m[2]}`],
    [/^Simulated migration succeeded; (\d+) scopes retained$/, m => `Симулированная миграция выполнена; сохранено прав: ${m[1]}`],
    [/^✓ Local chain validated\. Checked (\d+) events and (\d+) snapshots\. .*$/, m => `✓ Локальная цепочка подтверждена. Проверено событий: ${m[1]}, снимков: ${m[2]}. Это только локальная HMAC-цепочка: тот, у кого есть это хранилище браузера и ключ, может её переписать.`],
    [/^✕ (.+)$/, m => '✕ ' + tm(m[1])],
    [/^Save policy v(\d+)$/, m => `Сохранить политику v${m[1]}`],
    [/^Edit policy: (.+)$/, m => 'Изменить политику: ' + m[1]],
    [/^Version (\d+) · valid$/, m => `Версия ${m[1]} · валиден`],
    [/^Version (\d+) · invalid$/, m => `Версия ${m[1]} · НЕ валиден`],
    [/^Permissions v(\d+)$/, m => 'Права v' + m[1]],
    [/^Agent status updated to (\w+)$/, m => 'Статус агента: ' + (EXACT[m[1]] || m[1])],
    [/^MCP admission changed: (\w+)$/, m => 'Допуск MCP изменён: ' + (EXACT[m[1]] || m[1])],
    [/^Requires one of roles: (.+)$/, m => 'Нужна одна из ролей: ' + m[1].split(', ').map(r => ROLE[r] || r).join(', ')],
    [/^Local API is unreachable: (.+)$/, m => 'Локальный API недоступен: ' + m[1]],
    [/^· (.+)$/, m => '· ' + tr(m[1])],
    [/^(.+) · (AR-[0-9A-F]+)$/, m => `${tm(m[1])} · ${m[2]}`],
    [/^(.+) · independent scope evaluation$/, m => m[1] + ' · независимая проверка прав'],
    [/^(\S+) · (Sandbox|Local|Quarantined)$/, m => `${m[1]} · ${KIND[m[2]]}`],
    [/^(Finance|Procurement|Legal|Engineering|Operations) · (.+)$/, m => `${DEPT[m[1]]} · ${model(m[2])}`],
    [/^(.+ · simulated) → (.+ · simulated)$/, m => `${model(m[1])} → ${model(m[2])}`],
    [/^(.+) · simulated$/, m => m[1] + ' · симуляция'],
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
