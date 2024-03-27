# Altawin HTML-view workspace

Это расширение для Visual Studio Code позволяет редактировать исходный код и ресурсы HTML-представлений, которые сохраняются с БД altAwin.

Исходный код будет представлен в файле "index.html", а ресурсы представления будут отдельными файлами в корневой папке.

## Использование

Если у Вас есть уже созданное HTML-представление, то пропустите следущие шаги:

1. Создайте HTML-представление с пустым исходным кодом.
2. Перезапустите altAwin.

Перейдите в созданное представление, в котором нажмите кнопку VSCode.

Запустите VSCode и выберите 'F1 > altAwin: Add Workspace'.

В файловый менеждер VSCode будет добавлено рабочее пространство AWFS, представляющее собой корневую папку.

Для отсоединения рабочего пространства используйте 'F1 > Workspaces: Close Workspace'.

Редактировать можно только одно представление в один момент времени.

Для редактирование другого представления рекомендуется сначала отсоединить рабочее пространство, нажать кнопку VSCode в необходимом представлении и добавить рабочее пространство ещё раз.