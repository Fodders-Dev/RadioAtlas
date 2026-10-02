# Следующий участок: два новых направления после пяти карточек

02.10.2026. Историческая диагностика до исправления; [последующая реализация](LIRA-REPEAT-BUDGET-2026-10-02.md) прошла локальные проверки.
Исходный код `abbd431`, серверный кандидат `ce0c4d1`. Это отдельный участок
после выпуска контекста ответа, без новой композиции или платного прогона.

## Воспроизведённое поведение

`runLiraAgent`, его настоящее instrumentTools и лимит 6, синтетический каталог,
подставной model transport без сети. Человек продолжает подбор словами «и?»;
есть пять ранее показанных station IDs. Planner предлагает industrial и breakbeat.

Фактически вызываются search_stations и пять get_station. Остаётся одна новая
industrial-карточка; поиск breakbeat не доходит до провайдера. UUID-дубль,
зеркало с тем же URL и другим hash, одноимённое зеркало с codec suffix исключены.
Run остаётся completed/verifierPassed, но сообщает max_tool_calls_reached.
Это доказательство конкретного истощения бюджета, не оценка живой прозы.

Воспроизводитель подготовила Luna, основной агент прочитал исходник и повторил:
exit 0. [Результат](evals/lira-repeat-budget-2026-10-02.json).
Исходник сохранён как [диагностический пример](evals/lira-repeat-budget-2026-10-02.ts.txt);
для запуска из output/ расширение должно быть .ts: `npx --no-install tsx output/lira-repeat-budget-diagnosis.ts`.
Его assertions описывают текущий дефект; не включать их как норму продукта.

## Причина

brain.ts создаёт request-scoped exclusion matcher, используя уже instrumented
getStation. Его пять последовательных разрешений расходуют пять domain calls.
В production catalogToolProvider дополнительно разрешает те же IDs через
catalog.getStationById для фильтрации до cap. Повторная работа нужна brain для
custom providers и подтверждённых anchors в защите от старой прозы, поэтому
простое удаление фильтра сломает существующие гарантии.

Прямые тесты chatWithAssistant обходили instrumentTools: проверяли дедуп,
но не ограничение настоящего runner. MAX_TOOL_STEPS и maxToolCalls — разные
лимиты, увеличение planner steps не устраняет этот сбой.

## Предлагаемый ограниченный ремонт

Добавить необязательное пакетное разрешение ID к внутреннему ToolProvider.
Catalog provider разрешает максимум прежних 128 уникальных ID одним чтением
профилированного каталога, возвращая только существующие проверенные строки.
Runner считает пакет одной domain operation; не расширяет maxToolCalls=6.
Brain строит тот же exclusion matcher из verified batch rows, а старый
custom-provider путь сохраняется, если batch capability отсутствует.

Не передавать capability planner, не добавлять новый публичный chat endpoint
или пользовательский ввод, не снимать instrumentation. Пакет не означает
неограниченную сеть: production читает уже имеющийся in-process каталог,
а вход/выход ограничены 128 IDs/rows. Missing/mismatched rows не являются anchors;
все явные UUID остаются исключёнными независимо от успеха разрешения.
Ошибка пакета не должна скрывать рост числа individual calls или ослаблять
имеющуюся best-effort политику. Выбрать и протестировать её явно.

## Приёмка перед выпуском

- На настоящем runLiraAgent fixture с пятью prior IDs выполняются оба новых
  semantic search; обе разные группы представлены, инструментов не более 6.
- UUID, normalized stream URL и same-country normalized-name зеркала остаются
  исключёнными. Same-name другая страна и другая query string не становятся
  зеркалами без существующих правил identity.
- Unresolved exact UUID и ID за пределами 128-anchor cap остаются hard exclusions.
  Batch возвращает максимум 128 подтверждённых rows, сохраняет порядок приоритетов.
- Бытовое «и?» не вызывает batch или catalog; clarify/knowledge не начинают подбор.
  Сохраняются страна, запреты, количество и NoPlay.
- Повторное обращение использует request-scoped matcher, не долговременный кэш
  вкуса; concurrent calls не обходят tool-call limit.
- Убедиться, что production catalog provider использует capability, не только
  искусственный stub. Проверить bounded catalog reads и отсутствие внешней сети.
- Проверить типы, целевые runner/provider/brain тесты, полный API и offline.
  Перед production — same-SHA CI и public smoke. Новые платные ответы требуют
  отдельного согласованного бюджета; нынешний ledger закрыт.

После этого переходить к свободным реакциям человека из
[направления развития](LIRA-DISCOVERY-SYSTEM.md). Не добавлять анкету,
выдуманные акустические баллы или фоновое прослушивание потоков.
