/**
 * Practice companion v0: transparent, rule-based descriptions rather than
 * a claimed trained AI judge. Eventually an opt-in AI model can consume
 * anonymized summaries and historical context, not raw microphone audio.
 */
export function practiceCoach(metrics, mode) {
  if (!metrics || metrics.event_count < 4) return {
    observation: 'I am listening for a phrase.',
    suggestion: 'Play at least four strokes. You set the direction.',
    confidence: 'low',
    basis: 'insufficient detected onsets'
  };
  const cv = metrics.interhit_cv;
  const count = metrics.event_count;
  if (metrics.demo_events > 0) return {
    observation: 'Demonstration hits are playing through the timeline.',
    suggestion: 'Switch to live microphone capture to build a personal practice record.',
    confidence: 'demo',
    basis: 'simulated input; no musical performance was measured'
  };
  if (mode === 'free') return {
    observation: count + ' onsets captured. The vocabulary is yours.',
    suggestion: 'Try repeating one idea with a different dynamic shape. Use silence deliberately.',
    confidence: 'descriptive',
    basis: 'event count only; no qualitative judgement'
  };
  if (cv === null) return {
    observation: 'I can hear a developing pattern.',
    suggestion: 'Add another few beats to compare attacks and spacing.',
    confidence: 'low',
    basis: 'too few inter-onset intervals'
  };
  if (cv > 0.55) return {
    observation: 'The strike spacing changed substantially during this passage.',
    suggestion: mode === 'rudiments'
      ? 'Try a short, slow repetition. Let the sticks rebound without forcing uniformity.'
      : 'Repeat that phrase at a comfortable pace. Notice whether the changes were intentional.',
    confidence: 'descriptive',
    basis: 'inter-onset interval coefficient of variation'
  };
  if (cv < 0.16 && count > 12) return {
    observation: 'Your recent onset spacing is relatively even.',
    suggestion: mode === 'rudiments'
      ? 'Try accent displacement while keeping the sticking relaxed.'
      : 'Keep the pulse. Explore softer ghost strokes, then leave a deliberate rest.',
    confidence: 'descriptive',
    basis: 'regular observed inter-onset intervals'
  };
  return {
    observation: 'The phrase has a discernible pulse and variation.',
    suggestion: mode === 'rudiments'
      ? 'Try RLRR LRLL slowly and listen for differences in rebound.'
      : 'Explore one repeated idea in three dynamic shapes before adding complexity.',
    confidence: 'descriptive',
    basis: 'observed hit count and inter-onset variation'
  };
}
