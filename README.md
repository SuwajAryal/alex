# Alex · English speaking practice

Alex is a local voice practice app with casual conversations and IELTS Speaking mock tests.

## Start on Windows

1. Double-click **Start Alex.cmd**. Keep the launcher open while you practise.
2. If the browser does not open, visit [the local dashboard](http://127.0.0.1:8766/).
3. Choose **Gemini Live** and load a [Gemini API key](https://aistudio.google.com/apikey) from a project marked **Free Tier**. Leave billing disabled to avoid charges. To set up the backup, select **OpenAI Realtime Mini** and load its [API key](https://platform.openai.com/api-keys). OpenAI Realtime Mini is billed API usage. Both keys stay loaded for the current run, and Alex uses the provider you select before starting the call.
4. Choose **Casual chat** or **IELTS mock**, select **Start voice call**, and allow microphone access.

The launcher uses Node.js 22 or later. You can also run `node server.mjs` and open the dashboard yourself.

## Discuss a clip

Select **Discuss a clip**, paste a direct HTTPS audio link or choose an audio file up to 12 MB, then select **Prepare clip**. If the source website blocks browser access, download the audio and choose the file. Use the player to listen, then start a voice call. Alex opens with a reaction and talks through the ideas with you like a colleague after a talk.

Clip analysis uses your Gemini key. Either voice provider can use the resulting notes. Alex keeps the source audio and notes out of local practice history, which saves the conversation itself.

## Practice history

In **IELTS mock**, you can optionally upload one Speaking question sheet as a PNG, JPEG, WebP or PDF up to 10 MB, or paste a copied screenshot into the question-sheet field. Gemini extracts the Part 1 questions, Part 2 cue card and Part 3 questions. Check the extracted text before starting if you want to confirm the scan. Alex uses the sheet in the timed mock, and **Use built-in questions** clears it. The prepared sheet stays in the current browser tab.

Select **End and save call** to save both voices in one compressed audio file and store a timestamped transcript. The dashboard lets you replay or download the recording, read the transcript, or continue the conversation using recent turns.

Alex saves calls under the local `history/` folder. Git ignores that folder. Your selected provider processes call audio and transcription.

Select a transcript turn to play its excerpt. Older recordings use approximate timestamps. New calls capture speech and playback boundaries when available.

IELTS mocks generate written feedback after saving when a Gemini key is loaded. Open any saved mock to generate or upgrade its review. Gemini receives the transcript and, when supported, the recording. Alex saves the review locally. It includes evidence, tips and supported band estimates across the four IELTS Speaking criteria. An overall estimate requires all four bands.

In **Casual chat**, Alex chats like a friend, gives occasional corrections, and teaches useful words and phrases. Choose a call limit from 5 to 60 minutes, or **No time limit**. The default is 15 minutes. At the limit Alex ends and saves the call. **Reset timer** restarts the countdown or elapsed display while keeping the same call and recording.

**IELTS mock** follows the [IELTS Speaking format](https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-speaking). Alex runs a 4½-minute interview, a cue card with one minute of preparation and two minutes to speak, a short follow-up, and a 4½-minute discussion. Read the on-screen cue card and select **Start one-minute preparation** when ready. The full minute starts with that click. Part 3 shifts to new questions on broader issues related to the card. Coaching and written feedback come after the test. Starting from a saved mock opens a fresh test.

Gemini Live compresses older context and reconnects when Google rotates the connection. These features help a call run longer within the project's free quota. If a call disconnects, Alex saves the recording so you can continue from **Practice history** when voice access is available again.
