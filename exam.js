const cards = [
  { title: 'Describe a skill you learned outside school.', points: ['What the skill was', 'How you learned it', 'What you found difficult', 'Explain how learning it helped you'], angles: ['Why do some people prefer learning by doing?', 'Who should pay for training that helps adults change careers?', 'How might technology change which skills people need?'] },
  { title: 'Describe a place you like to visit in your free time.', points: ['Where it is', 'How often you go there', 'What you do there', 'Explain why you enjoy going there'], angles: ['What makes public spaces attractive to people of different ages?', 'Should cities spend more on parks or on indoor leisure facilities?', 'How might people spend their free time in the future?'] },
  { title: 'Describe a time someone gave you helpful advice.', points: ['Who gave you the advice', 'What the situation was', 'What advice they gave you', 'Explain how the advice affected you'], angles: ['Why might people seek advice from strangers?', 'What makes professional advice worth paying for?', 'How has social media affected which advice people trust?'] },
  { title: 'Describe a celebration you remember well.', points: ['What was celebrated', 'Who was there', 'What people did', 'Explain why it stands out'], angles: ['Why are public celebrations important to some communities?', 'How does tourism affect local traditions?', 'Which traditions are likely to change as younger people take over?'] },
  { title: 'Describe a product you repaired or kept using for a long time.', points: ['What the product was', 'How long you used it', 'How you looked after it', 'Explain why you kept it'], angles: ['Why do people replace items that still work?', 'Should manufacturers be required to make products easy to repair?', 'How might sharing or renting products change shopping habits?'] },
  { title: 'Describe a journey you remember.', points: ['Where you went', 'How you travelled', 'What happened during the journey', 'Explain why you remember it'], angles: ['What affects how people choose to travel?', 'How can towns improve transport for people without cars?', 'How might working from home affect future travel patterns?'] },
  { title: 'Describe a story you enjoyed.', points: ['What the story was about', 'Where you encountered it', 'Who it might appeal to', 'Explain what made it memorable'], angles: ['Why do people tell stories about their communities?', 'How does a film adaptation change the way people experience a story?', 'What role should libraries play as more people read and listen online?'] },
  { title: 'Describe a project you worked on with other people.', points: ['What you were trying to do', 'Who was involved', 'What your role was', 'Explain what you learned from the experience'], angles: ['When is teamwork more effective than working alone?', 'How should workplaces handle disagreement in teams?', 'What are the wider effects of more teams working remotely?'] },
  { title: 'Describe a meal you shared with other people.', points: ['Where you ate', 'Who you were with', 'What you ate', 'Explain why you remember the meal'], angles: ['Why do meals bring people together?', 'What influences the food habits of a country?', 'How might convenience food affect cooking traditions?'] },
  { title: 'Describe a time you spent outdoors.', points: ['Where you went', 'Who you were with', 'What you did', 'Explain how you felt afterwards'], angles: ['Why do some people have fewer opportunities to spend time outdoors?', 'How should schools balance outdoor activities with classroom time?', 'How can tourism in natural areas be managed?'] },
  { title: 'Describe a tool or app you find useful.', points: ['What it does', 'When you use it', 'How you learned to use it', 'Explain why you find it useful'], angles: ['What makes technology easy for different people to use?', 'Who is responsible for teaching people about online privacy?', 'Which everyday tasks should still be possible without a smartphone?'] },
  { title: 'Describe a change that improved your neighbourhood.', points: ['What changed', 'When it happened', 'Who benefited from it', 'Explain why it was an improvement'], angles: ['Why do residents disagree over local development?', 'How should councils decide which neighbourhood improvements to fund?', 'What might make a neighbourhood more inclusive in future?'] },
];
const topics = ['home and daily routines', 'work or studies and leisure', 'hometown and weekends', 'daily travel and music'];

export function nextCard(storage) {
  const key = 'alex.last-cue-card';
  const previous = storage?.getItem(key);
  const pool = cards.filter(card => card.title !== previous);
  const card = pool[Math.floor(Math.random() * pool.length)];
  storage?.setItem(key, card.title);
  return card;
}

export function createExam({ send, finish, show, setMicrophone, card = nextCard(), now = () => performance.now() }) {
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const stages = [
    { name: 'Part 1 · Introduction and interview', seconds: 270, instruction: `Start Part 1. Introduce yourself as the practice examiner and ask the candidate's name. Do not request identification or private details. Then interview them on familiar topics such as ${topic}. Ask one question at a time and cover at least two topics. Keep going until the next EXAM CONTROL instruction.` },
    { name: 'Part 2 · Preparation', seconds: 60, prepare: true, wait: true, mute: true, instruction: `Transition to Part 2. Read the title and each of the following points clearly, at an unhurried pace, pausing briefly between each point. Title: ${card.title} Points: ${card.points.join('. ')}. Then say: When you are ready to prepare, select Start one-minute preparation. Then stay silent.` },
    { name: 'Part 2 · Long answer', seconds: 120, wait: true, instruction: 'Say only a brief invitation to begin speaking now. Then let the candidate speak uninterrupted, even through pauses. Stay silent until the next EXAM CONTROL instruction.' },
    { name: 'Part 2 · Follow-up', seconds: 25, quietAfterPrompt: true, instruction: 'Stop the long answer politely and ask exactly one short follow-up question about the cue-card topic. Wait for the candidate to answer and remain silent until the app starts Part 3.' },
    { name: 'Part 3 · Discussion', seconds: 270, discussion: true, instruction: `Start Part 3 now, shifting from the candidate's personal story to wider issues. Ask: ${card.angles[0]} Ask one question at a time. After one follow-up, move to a different aspect of the theme. Never return to the candidate's personal example. The app will cue further angles.` },
    { name: 'IELTS mock complete', seconds: 0, wait: true, mute: true, instruction: 'Say only: Thank you. That is the end of the Speaking test.' },
  ];
  let index = -1;
  let deadline;
  let fallback;
  let completed = false;
  let followUpAsked = false;
  let angle = 0;
  let cardReady = false;

  function offerPreparation() {
    if (cardReady) return;
    cardReady = true;
    show('Part 2 · Read the cue card', null, card, true);
  }

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
    show(stage.name, stage.seconds, stage.prepare || index === 2 ? card : null);
  }

  function advance() {
    if (completed) return;
    const stage = stages[++index];
    deadline = undefined;
    fallback = now() + (stage.prepare ? 25000 : 8000);
    setMicrophone(!stage.mute && !stage.wait);
    show(stage.prepare ? 'Part 2 · Read the cue card' : stage.name, stage.prepare ? null : stage.seconds,
      stage.prepare || index === 2 ? card : null);
    send('EXAM CONTROL: ' + stage.instruction, stage);
    if (!stage.wait) ready();
  }

  return {
    start: advance,
    startPreparation() {
      if (stages[index]?.prepare && cardReady) ready();
    },
    examinerFinished() {
      if (index === 3) followUpAsked = true;
      if (stages[index]?.prepare) {
        if (deadline === undefined) offerPreparation();
      } else if (stages[index]?.wait) ready();
    },
    suppressSpeech() {
      return deadline !== undefined && (index === 1 || index === 2 || (index === 3 && followUpAsked));
    },
    tick() {
      if (completed || index < 0) return;
      if (deadline === undefined) {
        if (now() >= fallback) {
          if (stages[index].prepare) offerPreparation();
          else ready();
        }
        return;
      }
      const seconds = Math.ceil((deadline - now()) / 1000);
      if (seconds <= 0) advance();
      else show(stages[index].name, seconds, index === 1 || index === 2 ? card : null);
    },
    discussionTurn() {
      if (!stages[index]?.discussion || angle >= card.angles.length - 1 || now() >= deadline) return false;
      if (deadline - now() > (180 - angle * 90) * 1000) return false;
      angle++;
      send('EXAM CONTROL: Stay in Part 3. Move to a new angle and ask only this question: ' + card.angles[angle], stages[index]);
      return true;
    },
  };
}
