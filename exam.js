const cards = [
  { title: 'Describe a skill you learned outside school.', points: ['What the skill was', 'How you learned it', 'What you found difficult', 'Explain how learning it helped you'], discussion: 'learning practical skills, access to training, and how technology changes the way people learn' },
  { title: 'Describe a place you like to visit in your free time.', points: ['Where it is', 'How often you go there', 'What you do there', 'Explain why you enjoy going there'], discussion: 'public spaces, how people spend their leisure time, and what cities should provide for residents' },
  { title: 'Describe a time someone gave you helpful advice.', points: ['Who gave you the advice', 'What the situation was', 'What advice they gave you', 'Explain how the advice affected you'], discussion: 'where people seek advice, generational differences, and the influence of online advice' },
];
const topics = ['home and daily routines', 'work or studies and leisure', 'hometown and weekends', 'daily travel and music'];

export function createExam({ send, finish, show, setMicrophone, now = () => performance.now() }) {
  const card = cards[Math.floor(Math.random() * cards.length)];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const stages = [
    { name: 'Part 1 · Introduction and interview', seconds: 270, instruction: `Start Part 1. Introduce yourself as the practice examiner and ask the candidate's name. Do not request identification or private details. Then interview them on familiar topics such as ${topic}. Ask one question at a time and cover at least two topics. Keep going until the next EXAM CONTROL instruction.` },
    { name: 'Part 2 · Preparation', seconds: 60, wait: true, mute: true, instruction: `Transition to Part 2. Read this cue card: ${card.title} ${card.points.join('. ')}. Tell the candidate they have one minute to make notes and that you will tell them when to start. Then stay silent.` },
    { name: 'Part 2 · Long answer', seconds: 120, wait: true, instruction: 'Say only a brief invitation to begin speaking now. Then let the candidate speak uninterrupted, even through pauses. Stay silent until the next EXAM CONTROL instruction.' },
    { name: 'Part 2 · Follow-up', seconds: 25, quietAfterPrompt: true, instruction: 'Stop the long answer politely and ask exactly one short follow-up question about the cue-card topic. Wait for the candidate to answer and remain silent until the app starts Part 3.' },
    { name: 'Part 3 · Discussion', seconds: 270, instruction: `Start Part 3 now. Ask a broader question related to the cue card. Discuss ${card.discussion}. Ask one question at a time. Invite reasons, comparisons, consequences or predictions, with follow-ups based on the candidate's answers. Continue until the app ends the test.` },
    { name: 'IELTS mock complete', seconds: 0, wait: true, mute: true, instruction: 'Say only: Thank you. That is the end of the Speaking test.' },
  ];
  let index = -1;
  let deadline;
  let fallback;
  let completed = false;
  let followUpAsked = false;

  function ready() {
    if (completed || deadline !== undefined || index < 0) return;
    const stage = stages[index];
    if (!stage.seconds) {
      completed = true;
      finish();
      return;
    }
    setMicrophone(!stage.mute);
    deadline = now() + stage.seconds * 1000;
    show(stage.name, stage.seconds, index >= 1 ? card : null);
  }

  function advance() {
    if (completed) return;
    const stage = stages[++index];
    deadline = undefined;
    fallback = now() + (index === 1 ? 25000 : 8000);
    setMicrophone(!stage.mute && !stage.wait);
    show(stage.name, stage.seconds, index >= 1 ? card : null);
    send('EXAM CONTROL: ' + stage.instruction, stage);
    if (!stage.wait) ready();
  }

  return {
    start: advance,
    examinerFinished() {
      if (index === 3) followUpAsked = true;
      if (stages[index]?.wait) ready();
    },
    suppressSpeech() {
      return deadline !== undefined && (index === 1 || index === 2 || (index === 3 && followUpAsked));
    },
    tick() {
      if (completed || index < 0) return;
      if (deadline === undefined) {
        if (now() >= fallback) ready();
        return;
      }
      const seconds = Math.ceil((deadline - now()) / 1000);
      if (seconds <= 0) advance();
      else show(stages[index].name, seconds, index >= 1 ? card : null);
    },
  };
}
