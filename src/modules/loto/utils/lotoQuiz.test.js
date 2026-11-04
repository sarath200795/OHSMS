import { describe, expect, it } from 'vitest'
import { QUIZ, scoreQuiz } from './lotoQuiz'

describe('scoreQuiz', () => {
  it('counts only the chosen correct answers', () => {
    const all = QUIZ.map((item) => item.answer)
    expect(scoreQuiz(all)).toEqual({ correct: QUIZ.length, total: QUIZ.length })
    expect(scoreQuiz([0, 0, 0, 0]).correct).toBe(0)
  })
})
