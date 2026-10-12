import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreQuiz } from "@/lib/learning-shared";

test("Quiz: bestanden ab der gesetzten Grenze, Anzeige abgerundet", () => {
  assert.deepEqual(scoreQuiz([0, 1, 2], [0, 1, 0], 66), {
    correct: 2,
    total: 3,
    percent: 66,
    passPercent: 66,
    passed: true,
  });
  // 2 von 3 sind 66,7 % – eine Grenze von 67 % wird nicht erreicht.
  assert.equal(scoreQuiz([0, 1, 2], [0, 1, 0], 67).passed, false);
  assert.equal(scoreQuiz([0, 1], [0, 1], 100).passed, true);
  assert.equal(scoreQuiz([0, 1], [1, 0], 1).percent, 0);
  assert.equal(scoreQuiz([0, 1], [1, 0], 1).passed, false);
  assert.equal(scoreQuiz([], [], 50).passed, false);
});
