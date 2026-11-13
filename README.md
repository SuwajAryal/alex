# Alex · English speaking practice

Alex is a local voice practice app with casual conversations and IELTS Speaking mock tests.

## Start on Windows

1. Double-click **Start Alex.cmd**. Keep the launcher open while you practise.
2. If the browser does not open, visit [the local dashboard](http://127.0.0.1:8766/).
3. Choose **Gemini Live** and load a [Gemini API key](https://aistudio.google.com/apikey) from a project marked **Free Tier**. Leave billing disabled to avoid charges. To set up the backup, select **OpenAI Realtime Mini** and load its [API key](https://platform.openai.com/api-keys). OpenAI Realtime Mini is billed API usage. Both keys stay loaded for the current run, and Alex uses the provider you select before starting the call.
4. Choose **Casual chat** or **IELTS mock**, select **Start voice call**, and allow microphone access.

The launcher uses Node.js 22 or later. You can also run `node server.mjs` and open the dashboard yourself.

## Practice history

Select **End and save call** to save both voices in one compressed audio file and store a timestamped transcript. The dashboard lets you replay or download the recording, read the transcript, or continue the conversation using recent turns.

Alex saves calls under the local `history/` folder. Git ignores that folder. Your selected provider processes call audio and transcription.

Choose a call limit from 5 to 60 minutes, or **No time limit**. The default is 15 minutes. At the limit Alex ends and saves the call. **Reset timer** restarts the countdown or elapsed display while keeping the same call and recording. It does not reset provider quotas.

Gemini Live compresses older context and reconnects when Google rotates the connection. These features help a call run longer within the project's free quota. If a call disconnects, Alex saves the recording so you can continue from **Practice history** when voice access is available again.
