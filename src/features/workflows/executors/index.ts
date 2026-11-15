import type { WorkflowExecutor, WorkflowStepName } from "../types"
import { discoveryExecutor } from "./discovery.executor"
import { followUpExecutor } from "./follow-up.executor"
import { humanReviewExecutor } from "./human-review.executor"
import { prepareAtsExecutor } from "./prepare-ats.executor"
import { profileExecutor } from "./profile.executor"
import { rankExecutor } from "./rank.executor"
import { researchExecutor } from "./research.executor"
import { stagingExecutor } from "./staging.executor"
import { tailorExecutor } from "./tailor.executor"
import { trackingExecutor } from "./tracking.executor"
import { validateExecutor } from "./validate.executor"

/**
 * One implementation per step name. The worker fails a step with a specific
 * message if a name is missing, instead of silently skipping work.
 */
const EXECUTORS: Record<WorkflowStepName, WorkflowExecutor> = {
  PROFILE: profileExecutor,
  DISCOVER: discoveryExecutor,
  RANK: rankExecutor,
  RESEARCH: researchExecutor,
  TAILOR: tailorExecutor,
  VALIDATE: validateExecutor,
  PREPARE_ATS: prepareAtsExecutor,
  HUMAN_REVIEW: humanReviewExecutor,
  SUBMISSION_STAGING: stagingExecutor,
  TRACKING: trackingExecutor,
  FOLLOW_UP: followUpExecutor,
}

export function getExecutor(name: WorkflowStepName): WorkflowExecutor | undefined {
  return EXECUTORS[name]
}
