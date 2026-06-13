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
  workerFallbackServiceId?: string;
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

    // Step 3: Fallback Research (conditional — only if grade is low and fallback configured)
    {
      name: 'fallback_research',
      agent: 'FallbackWorker',
      serviceId: config.workerFallbackServiceId ?? '',
      conditional: (ctx) => {
        if (!config.workerFallbackServiceId) return false;
        const gradeResult = ctx.results.grade as { score?: number } | undefined;
        // Architecture: Default to 0 to FORCE retry if grading failed
        return (gradeResult?.score ?? 0) < ctx.qualityThreshold;
      },
      buildRequirement: (ctx) => ({
        topic: ctx.topic,
        depth: 'comprehensive',
        context: 'Fallback retry due to low quality initial draft.',
      }),
    },

    // Step 4: Fallback Grade (conditional — only if fallback research ran)
    {
      name: 'fallback_grade',
      agent: 'Litmus',
      serviceId: config.litmusServiceId,
      conditional: (ctx) => !!ctx.results.fallback_research,
      buildRequirement: (ctx) => ({
        deliverable: (ctx.results.fallback_research as { draft?: string })?.draft ?? '',
        context: `Grading fallback research brief on: ${ctx.topic}`,
      }),
    },

    // Step 5: Escalate (conditional — only if final grade is low or forceEscalation)
    {
      name: 'escalate',
      agent: 'Summon',
      serviceId: config.summonServiceId,
      conditional: (ctx) => {
        if (ctx.forceEscalation) return true;
        // Check fallback grade if it exists, otherwise original grade
        const finalGrade = (ctx.results.fallback_grade || ctx.results.grade) as { score?: number } | undefined;
        // Architecture: Default to 0 to FORCE human review if grading failed
        return (finalGrade?.score ?? 0) < ctx.qualityThreshold;
      },
      buildRequirement: (ctx) => {
        const finalGrade = (ctx.results.fallback_grade || ctx.results.grade) as { score?: number; gaps?: string[] } | undefined;
        return {
          prompt: `Research brief on "${ctx.topic}" scored ${finalGrade?.score ?? '??'}/100.\n\nGaps: ${finalGrade?.gaps?.join(', ') ?? 'none listed'}\n\nShould this brief be shipped to the client?`,
          context: `Maestro orchestration — quality gate escalation`,
        };
      },
    },
  ];
}
