// A short quiz on hazardous-energy control. The questions are original.
// They are not copied from a site roster or from another application's text.

export const QUIZ = [
  {
    q: 'What is confirmed before work starts on isolated equipment?',
    options: ['The machine is still energised', 'Stored energy is at zero', 'The permit window has no end'],
    answer: 1,
  },
  {
    q: 'Who removes a personal lock on a group lockout?',
    options: ['Anyone on the permit', 'Only the person who applied it', 'The next shift, without checking'],
    answer: 1,
  },
  {
    q: 'When does the primary lock come off?',
    options: ['First, so the job can start', 'After every other lock is off', 'Whenever the window ends'],
    answer: 1,
  },
  {
    q: 'What does a tag on a lock tell the next person?',
    options: ['The equipment may be started', 'The isolation point must not be operated', 'The permit has been deleted'],
    answer: 1,
  },
]

export function scoreQuiz(answers) {
  const correct = QUIZ.filter((item, i) => answers[i] === item.answer).length
  return { correct, total: QUIZ.length }
}
