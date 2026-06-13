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
  absoluteDeadline: number;
  /** Accumulated results from previous steps. */
  results: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getDraft = (res: unknown): string => 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof res === 'object' && res !== null && 'draft' in res && typeof (res as any).draft === 'string') ? (res as any).draft : '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getScore = (res: unknown): number => 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof res === 'object' && res !== null && 'score' in res && typeof (res as any).score === 'number') ? (res as any).score : 100;

export function buildPipeline(config: {
  workerServiceId: string;
  workerFallbackServiceId?: string;
  litmusServiceId: string;
  summonServiceId: string;
}): PipelineStep[] {
  return [
    {
      name: 'research',
      agent: 'Worker',
      serviceId: config.workerServiceId,
      buildRequirement: (ctx) => ({ topic: ctx.topic, depth: 'comprehensive' }),
    },
    {
      name: 'grade',
      agent: 'Litmus',
      serviceId: config.litmusServiceId,
      buildRequirement: (ctx) => ({
        deliverable: getDraft(ctx.results.research),
        context: `Grading a research brief on: ${ctx.topic}`,
      }),
    },
    {
      name: 'fallback_research',
      agent: 'FallbackWorker',
      serviceId: config.workerFallbackServiceId ?? '',
      conditional: (ctx) => {
        if (!config.workerFallbackServiceId) return false;
        return getScore(ctx.results.grade) < ctx.qualityThreshold;
      },
      buildRequirement: (ctx) => ({
        topic: ctx.topic,
        depth: 'comprehensive',
        context: 'Fallback retry due to low quality initial draft.',
      }),
    },
    {
      name: 'fallback_grade',
      agent: 'Litmus',
      serviceId: config.litmusServiceId,
      conditional: (ctx) => !!ctx.results.fallback_research,
      buildRequirement: (ctx) => ({
        deliverable: getDraft(ctx.results.fallback_research),
        context: `Grading fallback research brief on: ${ctx.topic}`,
      }),
    },
    {
      name: 'escalate',
      agent: 'Summon',
      serviceId: config.summonServiceId,
      conditional: (ctx) => {
        if (ctx.forceEscalation) return true;
        const finalGrade = ctx.results.fallback_grade || ctx.results.grade;
        return getScore(finalGrade) < ctx.qualityThreshold;
      },
      buildRequirement: (ctx) => {
        const finalResult = ctx.results.fallback_grade || ctx.results.grade;
        const score = getScore(finalResult);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gaps = (typeof finalResult === 'object' && finalResult !== null && Array.isArray((finalResult as any).gaps)) 
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (finalResult as any).gaps.join(', ') : 'none listed';
        
        return {
          prompt: `Research brief on "${ctx.topic}" scored ${score}/100.\n\nGaps: ${gaps}\n\nShould this brief be shipped to the client?`,
          context: `Maestro orchestration — quality gate escalation`,
        };
      },
    },
  ];
}
