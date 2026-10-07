import { config } from '../config';
import type { Planner } from './planner';
import { ScriptedPlanner } from './scriptedPlanner';
import { OpenAIPlanner } from './openaiPlanner';

let override: Planner | null = null;
export function setPlannerForTesting(p: Planner | null) { override = p; }

export function getPlanner(): Planner {
  if (override) return override;
  return config.planner === 'openai' ? new OpenAIPlanner(config.openaiModel) : new ScriptedPlanner({ simulateCompromise: config.demoMode });
}
