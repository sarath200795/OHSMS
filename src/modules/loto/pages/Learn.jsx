import { useState } from 'react'
import { QUIZ, scoreQuiz } from '../utils/lotoQuiz'
import PageHeader, { HdrIcon } from '../components/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'

export default function Learn() {
  const [answers, setAnswers] = useState({})
  const [score, setScore] = useState(null)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        icon={<HdrIcon d={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>} />}
        title="Learn about LOTO"
        subtitle="Hazardous energy control, in short. Then a four-question check."
      />
      <Card animate={false} className="mt-4 space-y-3 !p-5 text-sm text-steel-200">
        <p>Lockout keeps a machine from starting, and from releasing stored energy, while someone is working on it. The procedure says how. The permit says who is doing this job, on this shift.</p>
        <p>Isolate each energy source, put a lock on it, put a tag on that lock, and try the controls to confirm zero energy before work starts. On a group lockout each person removes only their own lock. The primary lock comes off last.</p>
      </Card>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          setScore(scoreQuiz(answers))
        }}
      >
        {QUIZ.map((item, i) => (
          <fieldset key={item.q} className="rounded-xl border border-steel-700 p-4">
            <legend className="px-1 text-sm font-semibold text-steel-100">{item.q}</legend>
            {item.options.map((option, n) => (
              <label key={option} className="mt-2 flex items-center gap-2 text-sm text-steel-200">
                <input
                  type="radio"
                  name={`q${i}`}
                  checked={answers[i] === n}
                  onChange={() => setAnswers((a) => ({ ...a, [i]: n }))}
                />
                {option}
              </label>
            ))}
          </fieldset>
        ))}
        <Button type="submit">Check answers</Button>
        {score && (
          <p role="status" className="text-sm font-semibold text-steel-100">
            {score.correct} of {score.total} correct.
          </p>
        )}
      </form>
    </div>
  )
}
