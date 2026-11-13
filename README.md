# Alex · English speaking practice

Alex is a local voice practice app with casual conversations and IELTS Speaking mock tests.

## Start on Windows

1. Double-click **Start Alex.cmd**. Keep the launcher open while you practise.
2. If the browser does not open, visit [the local dashboard](http://127.0.0.1:8766/).
3. Open **Voice setup** and load an OpenAI API key with API billing enabled.
4. Choose **Casual chat** or **IELTS mock**, select **Start voice call**, and allow microphone access.

The launcher uses Node.js 22 or later. You can also run `node server.mjs` and open the dashboard yourself.

## Practice history

Select **End and save call** to save both voices in one compressed audio file and store a timestamped transcript. The dashboard lets you replay or download the recording, read the transcript, or continue the conversation using recent turns.

Alex saves calls under the local `history/` folder. Git ignores that folder. The API key stays in memory for the current run, and OpenAI processes the call audio and transcription.
