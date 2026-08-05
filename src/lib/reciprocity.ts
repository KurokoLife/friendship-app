// F20: reciprocity awareness, expanded beyond simple initiation counting
// to three conversational dimensions, tracked across the last 10 messages
// of a connection:
//   1. Question reciprocity, who asks vs. who only answers
//   2. Depth reciprocity, who shares vs. who only responds to what's asked
//   3. Message length imbalance, one person consistently writing far more
//
// All three are heuristics over plain message text, not a Claude call:
// this is a private, ambient observation, not a drafted message, so
// there's nothing for Claude to articulate on the user's behalf. The
// thresholds below (2x, 1.5x, minimum counts) are a reasonable judgment
// call, not derived from any study, worth revisiting if it fires too
// eagerly or too rarely in practice, same caveat this app already applies
// to its other hand-picked heuristics (e.g. F6's scenario point values).
type MinimalMessage = { sender_id: string; content: string };

const RECENT_WINDOW = 10;
const MIN_MESSAGES_PER_SIDE = 2;
const SUBSTANTIVE_LENGTH = 60;
const IMBALANCE_RATIO = 2;
const LENGTH_IMBALANCE_RATIO = 1.5;
const MIN_DIMENSIONS_FOR_SIGNAL = 2;

function isQuestion(content: string): boolean {
  return content.includes('?');
}

function isSubstantive(content: string): boolean {
  return content.trim().length >= SUBSTANTIVE_LENGTH;
}

function avgLength(messages: MinimalMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length;
}

// Returns true if the viewer (myId) has been doing meaningfully more of
// the asking, sharing, and writing than the other participant, across at
// least 2 of the 3 tracked dimensions. Requires enough recent messages
// from both sides to mean something, a quiet conversation with only 1-2
// messages each shouldn't trigger this.
export function isDoingMostOfTheWork(messages: MinimalMessage[], myId: string): boolean {
  const recent = messages.slice(-RECENT_WINDOW);
  const mine = recent.filter((m) => m.sender_id === myId);
  const theirs = recent.filter((m) => m.sender_id !== myId);
  if (mine.length < MIN_MESSAGES_PER_SIDE || theirs.length < MIN_MESSAGES_PER_SIDE) return false;

  const myQuestions = mine.filter((m) => isQuestion(m.content)).length;
  const theirQuestions = theirs.filter((m) => isQuestion(m.content)).length;
  const questionImbalance = myQuestions >= MIN_MESSAGES_PER_SIDE && myQuestions >= theirQuestions * IMBALANCE_RATIO;

  const mySubstantive = mine.filter((m) => isSubstantive(m.content)).length;
  const theirSubstantive = theirs.filter((m) => isSubstantive(m.content)).length;
  const depthImbalance =
    mySubstantive >= MIN_MESSAGES_PER_SIDE && mySubstantive >= theirSubstantive * IMBALANCE_RATIO;

  const myAvgLength = avgLength(mine);
  const theirAvgLength = avgLength(theirs);
  const lengthImbalance = myAvgLength >= SUBSTANTIVE_LENGTH && myAvgLength >= theirAvgLength * LENGTH_IMBALANCE_RATIO;

  const dimensionsFavoringMe = [questionImbalance, depthImbalance, lengthImbalance].filter(Boolean).length;
  return dimensionsFavoringMe >= MIN_DIMENSIONS_FOR_SIGNAL;
}

export const RECIPROCITY_NOTE =
  'You have been doing most of the asking and sharing in this conversation. That can feel draining over time. It might be worth noticing whether the curiosity goes both ways.';
