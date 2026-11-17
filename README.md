# Alex · English speaking practice

Alex is a downloadable voice practice app for English conversation and IELTS Speaking. Run it on your computer, choose a voice provider, and connect with your own API key.

**[Download Alex for Windows (ZIP)](https://codeload.github.com/SuwajAryal/alex/zip/refs/heads/main)**

## Quick start

1. Install [Node.js LTS](https://nodejs.org/en/download/) (22 or newer). You do not need to install any project packages.
2. Download and extract the ZIP. Open the extracted folder and double-click **Start Alex.cmd**.
3. Keep the launcher window open. If Alex does not open in your browser, visit [the local dashboard](http://127.0.0.1:8766/).
4. Choose a provider and load your own key under **Voice setup**. Select a practice mode, start a call, and allow microphone access.

You can also run `node server.mjs` from the extracted folder and open the local dashboard yourself.

## Choose a provider

| Provider | What to use |
| --- | --- |
| **Gemini Live** | A [Gemini API key](https://aistudio.google.com/apikey). For free usage, use an eligible Free Tier project with billing disabled. Usage limits apply. Gemini also reads question sheets, analyzes listening clips, and generates written IELTS feedback. |
| **OpenAI Realtime Mini** | An [OpenAI API key](https://platform.openai.com/api-keys) with Realtime API access and API billing. This is a paid voice option. |

You can load both keys and choose the provider before each call. Keys entered in the dashboard stay in memory until you close Alex.

## Practice modes

- **Casual chat.** Talk like friends, get occasional corrections, and practise useful words and phrases. Set a call limit or practise without a timer.
- **IELTS mock.** Take a timed three-part interview. Use Alex’s rotating topics, upload an image or PDF, or paste a screenshot. To use text, paste a sheet with Part 1, Part 2 and Part 3 headings into **Paste question text**, then select **Use these questions**. The app parses pasted text on your computer and sends the questions to your chosen voice provider during the mock. In Part 2, read the cue card and select **Start one-minute preparation** when ready. With a Gemini key loaded, saved mocks can get feedback and estimated bands for the four IELTS Speaking criteria when the evidence supports them.
- **Discuss a clip.** Paste a direct HTTPS audio link or choose an audio file up to 12 MB. Prepare it with Gemini, listen in the player, then discuss the ideas with Alex. If a site blocks direct browser access, download the clip first and choose the file.

## Recordings and privacy

Choose **End and save call** to keep a compressed recording and timestamped transcript. Reopen the call from **Practice history** and select a transcript turn to replay that excerpt. Older recordings have approximate timestamps.

Your chosen provider processes call audio and transcription. Gemini receives the materials used for sheet reading, clip analysis, or IELTS feedback. Alex saves practice history in the local `history/` folder, which Git ignores.
