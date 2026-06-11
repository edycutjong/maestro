/**
 * Maestro — Pipeline planner.
 *
 * Fixed pipeline: research → grade → [escalate] → compose.
 * This is deliberately NOT an open-ended autonomous planner.
 * The pipeline is narrow, legible, and fully on-chain.
 */

export interface PipelineStep {
  name: string;
  agent: string;
  serviceId: string;
  buildRequirement: (ctx: PipelineContext) => Record<string, unknown>;
  /** If true, this step only runs conditionally (e.g., Summon on low grade). */
  conditional?: (ctx: PipelineContext) => boolean;
}

export interface PipelineContext {
  topic: string;
  qualityThreshold: number;
  forceEscalation: boolean;
  /** Accumulated results from previous steps. */
  results: Record<string, unknown>;
}

/**
 * Build the fixed Maestro pipeline.
 *
 * @param config - Service IDs for the agents in the chain
 */
export function buildPipeline(config: {
  workerServiceId: string;
  litmusServiceId: string;
  summonServiceId: string;
}): PipelineStep[] {
  return [
    // Step 1: Research
    {
      name: 'research',
      agent: 'Worker',
      serviceId: config.workerServiceId,
      buildRequirement: (ctx) => ({
        topic: ctx.topic,
        depth: 'comprehensive',
      }),
    },

    // Step 2: Grade
    {
      name: 'grade',
      agent: 'Litmus',
      serviceId: config.litmusServiceId,
      buildRequirement: (ctx) => ({
        deliverable: (ctx.results.research as { draft?: string })?.draft ?? '',
        context: `Grading a research brief on: ${ctx.topic}`,
      }),
    },

    // Step 3: Escalate (conditional — only if grade is low or forceEscalation)
    {
      name: 'escalate',
      agent: 'Summon',
      serviceId: config.summonServiceId,
      conditional: (ctx) => {
        if (ctx.forceEscalation) return true;
        const gradeResult = ctx.results.grade as { score?: number } | undefined;
        return (gradeResult?.score ?? 100) < ctx.qualityThreshold;
      },
      buildRequirement: (ctx) => {
        const gradeResult = ctx.results.grade as { score?: number; gaps?: string[] } | undefined;
        return {
          prompt: `Research brief on "${ctx.topic}" scored ${gradeResult?.score ?? '??'}/100.\n\nGaps: ${gradeResult?.gaps?.join(', ') ?? 'none listed'}\n\nShould this brief be shipped to the client?`,
          context: `Maestro orchestration — quality gate escalation`,
        };
      },
    },
  ];
}
