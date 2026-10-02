# index.md — dsh-image-gen

Краткая карта проекта. Подробности — в `AGENTS.md` и `docs/design/DESIGN.md`.

## Что это

Хост-плагин DeepSeek Harness (DSH) для генерации, редактирования и обработки изображений. Поддерживает 30 инструментов (генерация, inpainting, style anchors/FaceID, SVG-векторизация, палитры, спрайты, схемы, PWA-иконки) и подключаемые провайдеры (FAL.ai, OpenAI, ComfyUI, Automatic1111, Gemini, Replicate, DSH Subscription Images).

## Пути и статус

- **DEV**: `/mnt/external/Project/DEV/dhsplugins/dsh-image-gen`
- **Пакет**: `@goodandready/dsh-image-gen` (публичный npm-реестр и зеркало на GitHub)
- **Установка**: профиль `web` в `$DSH_HOME/profiles/web` (`/home/vadim/.dsh/profiles/web`)
- **Статус**: `active`, версия `0.11.28` (подготовка `0.11.29`), CI и offline-тесты зелёные (368/368 PASS).

## Точки входа

- Серверная половина: `lib/index.js` (регистрация плагина в Cordis, схема конфигурации, маршруты).
- Клиентская половина: `src/client/*` (исходники UI) -> сборка в `lib/client.js` (`npm run build:client`).
- Тесты: `npm test` (`node scripts/build-client.mjs --check && node --check lib/client.js && node --import ./test/_setup.mjs --test test/*.test.mjs`).

## Ключевые компоненты

- `lib/register-tools.js` — регистрация и динамический контроллер профилей инструментов (`minimal`, `all`, `custom`).
- `lib/providers.js` и `lib/providers/backends/` — адаптеры провайдеров генерации и редактирования.
- `lib/frontend-assets.js` — векторный трейсер контуров в SVG, генератор палитр WCAG, сборщик PWA-иконок и favicon.ico.
- `lib/history.js` — ведение истории генераций с дисковым кэшем и атомарной записью через `@deepseek-ai/dsh-atomic-write`.
- `lib/live-progress.js` — SSE-хаб живого стриминга прогресса генерации (`/dsh-image-gen/live-events`).
- `lib/vault.js` — защищённое хранилище и просмотр медиа-архива плагина (`/dsh-image-gen/vault`).
- `lib/cost-meter.js` и `lib/loop-guard.js` — контроль суточного бюджета и защита от зацикливания агента.

## Проверка и публикация

- `npm ci` — воспроизводимая чистая установка зависимостей.
- `npm test` — полный прогон оффлайн-тестов и проверка клиентского бандла.
- `npm pack --dry-run` — проверка состава публикуемого npm-пакета.
- `bash scripts/publish-github.sh --check` — проверка чистоты публикуемого GitHub-дерева (служебные `AGENTS.md`, `index.md`, `deploy.sh`, `.gitea` исключаются).
- `systemctl --user restart dsh-web.service` — перезапуск хоста DSH после развёртывания в профиль `web`.
