# Video response debugging

The video page automatically keeps the last API response in browser storage
under `video-debug-last-response`.

Use the `Réponse JSON` button on the result screen to download the response,
then place the downloaded JSON files in this directory. Compare the `response`
object with the JSON returned by Postman. The `request` information also shows
the filename, MIME type, size, and browser request duration.

Browsers cannot write files directly into the project directory. The download
button is therefore intentional and avoids granting filesystem permissions to
the application.