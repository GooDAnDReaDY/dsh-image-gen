# AGENTS.md — dsh-image-gen

## Project Overview & Current State

- **Проект**: `@goodandready/dsh-image-gen` — официальный хост-плагин генерации и обработки изображений для DeepSeek Harness (DSH).
- **Расположение**: `/mnt/external/Project/DEV/dhsplugins/dsh-image-gen` на хосте MiniAI (`192.168.1.111`).
- **Текущая версия**: `0.11.28` (подготовка к `0.11.29`).
- **Gitea-репозиторий**: `http://192.168.1.111:3005/goodandready/dsh-image-gen` (SSH: `ssh://gitea-claude:2222/goodandready/dsh-image-gen.git`).
- **Публичный GitHub-зеркало**: `https://github.com/GooDAnDReaDY/dsh-image-gen.git` (sanitized tree, исключающий служебные файлы).
- **npm-пакет**: `@goodandready/dsh-image-gen` (публичный доступ).
- **Production-профиль**: `$DSH_HOME/profiles/web` (`/home/vadim/.dsh/profiles/web`), сервис `dsh-web.service`.

## Architecture & Boundaries

- **Cordis Service & Host Plugin**: Плагин подключается к контексту DSH Cordis v4 (`ctx.tools`, `ctx.attachment`, `ctx.credentials`, `ctx.webServer`, `ctx.settings`, `ctx.llm`).
- **Две половины плагина**:
  - *Серверная часть* (`lib/`): регистрация 30 инструментов (`lib/register-tools.js`), провайдеры (`lib/providers.js`), обработка изображений (`sharp`), хранение истории и настроек под атомарной записью (`@deepseek-ai/dsh-atomic-write`), SSE hub событий прогресса (`lib/live-progress.js`), HTTP-эндпоинты хранилища (`/dsh-image-gen/vault`) и статуса (`/dsh-image-gen/status`).
  - *Клиентская часть* (`src/client/*` -> `lib/client.js`): скомпилированный бандл настроек, карточек предпросмотра, UI-слотов и воркбенчей. Файл `lib/client.js` никогда не редактируется вручную; правки вносятся исключительно в `src/client/*` с последующей сборкой `npm run build:client`.
- **Профили инструментов (`toolsetProfile`)**:
  - `minimal`: 3 ключевых инструмента (`generate_image`, `edit_image`, `inspect_image_quality`).
  - `all`: все 30 инструментов (генерация, инпеинт, FaceID/IP-Adapter, палитры, векторный SVG-трейсинг, спрайты, схемы, PWA-иконки, фавиконы).
  - `custom`: произвольный набор, управляемый булевыми флагами в настройках.
- **Изоляция путей (Path Traversal Protection)**:
  - Любое обращение к локальным файлам (`resolveSource`, `resolveConversationImage`) строго валидирует канонические пути через `fs.realpath`. Попытки выхода через symlink за пределы рабочей директории немедленно пресекаются ошибкой `Access denied`.

## Canonical Technology Stack

- **Среда выполнения**: Node.js >= 20, ES Modules (`type: "module"`).
- **Фреймворк плагинов**: `@deepseek-ai/cordis` ^4.0.1, `@deepseek-ai/schemastery` ^3.18.1.
- **Прямые runtime-зависимости**:
  - `sharp` (`^0.33.5 || ^0.35.0`) — нативное декодирование пикселей, трансформация форматов PNG/JPEG/WebP, альфа-композитинг, масштабирование и seam-анализ.
  - `@deepseek-ai/dsh-atomic-write` (`^0.1.7-rc.2 || ^0.2.0-rc.1 || ^0.2.0-rc.2`) — атомарная запись файлов истории и настроек без риска повреждения при гонках.
- **Peer-зависимости DSH**:
  - `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-attachment`, `@deepseek-ai/dsh-credentials`, `@deepseek-ai/dsh-host-webserver`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-system-prompt`.
- **Провайдеры**:
  - Облачные: FAL (`fal.ai`), OpenAI DALL-E / Images API, Gemini (`Google Imagen/Gemini`), Replicate, Custom OpenAI-compatible.
  - Локальные: ComfyUI (WebSocket + HTTP API), Automatic1111 (Stable Diffusion WebUI API).
  - Подписочные: DSH Subscription Images (без API-ключей через хост-сервис).

## Core Rules & Invariants

1. **Непереговорное версионирование**:
   - Обычный релиз инкрементирует **только третью цифру** (`x.y.z` -> `x.y.(z+1)`). Изменение второй цифры `y` допустимо исключительно по прямому указанию пользователя.
2. **Безопасность публикации (Sanitized Mirror)**:
   - `AGENTS.md`, `index.md`, `deploy.sh`, `.gitea/`, `.worktrees/`, `.planning/` **никогда не публикуются** в публичный GitHub, GitHub Release, GitHub Packages или npm-архив. Они исключены через `.gitattributes` (`export-ignore`), `scripts/publish-github.sh` (`FORBIDDEN`) и `package.json` (`files`).
   - Публичные `README.md`, `README.ru.md`, `README.zh.md`, `LICENSE`, `cordis.patch.yml` обязательно входят в публикуемые пакеты.
3. **Безопасность API и хоста**:
   - Никаких платных API-вызовов в тестах. Все тесты выполняются исключительно через оффлайн-заглушки (synthetic image buffers, mock HTTP fetch).
   - При `cfg.enabled: false` все 30 инструментов обязаны мгновенно блокировать выполнение без единого сетевого запроса.
4. **Контракт целостности файлов**:
   - Никаких частичных или повреждённых fallback-структур под видом валидных изображений. Недекодируемые буферы должны выдавать честную ошибку, а не синтетический шум.

## Development & Testing Workflow

- **Чистая установка зависимостей**:
  ```bash
  npm ci
  ```
- **Сборка клиентского интерфейса**:
  ```bash
  npm run build:client
  npm run build:client:check
  ```
- **Запуск полного тестового набора**:
  ```bash
  npm test
  # Эквивалентно: node scripts/build-client.mjs --check && node --check lib/client.js && node --import ./test/_setup.mjs --test test/*.test.mjs
  ```
- **Проверка состава npm-пакета**:
  ```bash
  npm pack --dry-run
  ```
- **Проверка чистоты зеркала GitHub**:
  ```bash
  bash scripts/publish-github.sh --check
  ```

## Publication & Deployment Matrix

1. **Gitea PR & Merge**:
   - Разработка ведётся в ветках `fix/*` или `feat/*` в изолированных `.worktrees/<branch>`.
   - PR создаётся через `gitea_tool.py create_pr`.
   - Слияние выполняется fast-forward или merge commit после прохождения тестов.
2. **Релиз**:
   - Инкремент версии в `package.json` (`npm version patch --no-git-tag-version`).
   - Синхронизация `CHANGELOG.md`.
   - Коммит `chore(release): bump version to x.y.z`.
   - Создание тега `vx.y.z`.
   - Публикация в sanitized GitHub: `bash scripts/publish-github.sh --push vx.y.z`.
3. **Deploy в Production Web Profile**:
   - Каталог профиля: `/home/vadim/.dsh/profiles/web`.
   - Установка через локальный tarball / пакетный менеджер профиля.
   - Перезапуск сервиса: `sudo -u vadim -H systemctl --user restart dsh-web.service`.
   - Проверка работоспособности:
     - `curl -s http://127.0.0.1:5173/dsh-image-gen/status` -> HTTP 200 / JSON.
     - `curl -s http://127.0.0.1:5173/dsh-image-gen/vault` -> HTTP 200 / JSON.

## Remote Execution Protocol (Windows PC)

- Все действия выполняются удалённо на MiniAI (`192.168.1.111`).
- Исполняющий пользователь: `vadim` (транспортный SSH-пользователь: `migrate`).
- Формат команды:
  ```powershell
  ssh.exe -i C:\Users\vadim\.ssh\codex_migrate2 migrate@192.168.1.111 "sudo -u vadim -H bash -lc 'export PATH=/home/vadim/.ssh/bin:/home/vadim/.local/bin:/usr/local/bin:/usr/bin:/bin; <команды>'"
  ```
- Для Git используется серверный wrapper `/home/vadim/.ssh/bin/git-antigravity`.

## Autonomous Execution & Task Boundaries

- При поручении пула задач агент автономно проходит цикл `worktree -> реализация -> npm test -> build:client:check -> commit -> push -> PR -> merge -> release -> deploy -> cleanup`.
- Остановка требуется только при safety-stop, архитектурных развилках или явных деструктивных действиях, требующих подтверждения владельца.
- После деплоя и приёмки worktree удаляется безопасно (`git worktree remove`), ветка удаляется локально и в remote (`git branch -d`).

## Known Issues & Limitations

- **#353 / #355**: Учёт расходов и контроль бюджета при повторах quality gate и конкурентных запросах.
- **#357**: Ключ кэша истории должен включать `output_format` и `aspect_ratio`.
- **#360**: Vision OCR в `replace_image_text` должен честно рапортовать статус наложения текста при несовпадении размеров.
- **#364**: Актуализация model ID и структуры ImageConfig для Gemini.
- **#370**: Укрепление Loop Guard и передача exec в `edit_image`.
- **#374**: Санитизация SVG от XML/SMIL атак и обфусцированных URI.
- **#375**: Валидация поддержки FaceID на уровне модели/воркфлоу провайдера.
- **#379**: Сохранение ранних SSE-подписчиков при инициализации сессии прогресса.
- **#382**: Расширение smoke-тестов на проверку структурных контрактов результатов.
- **#399**: Честный отказ (throw) при передаче повреждённых изображений вместо синтетического fallback.

## Maintenance

- Файл обновляется при добавлении новых инструментов, изменении схемы зависимостей или протоколов деплоя.
- При расхождениях приоритет имеет корневой `/mnt/external/Project/DEV/AGENTS.md`.
