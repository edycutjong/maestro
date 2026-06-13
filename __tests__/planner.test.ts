import { describe, it, expect } from 'vitest';
import { buildPipeline } from '../src/planner.js';

describe('Maestro Planner', () => {
  const config = {
    workerServiceId: 'svc_worker',
    litmusServiceId: 'svc_litmus',
    summonServiceId: 'svc_summon',
  };

  it('builds a 5-step pipeline with correct service IDs', () => {
    const pipeline = buildPipeline(config);
    expect(pipeline).toHaveLength(5);
    expect(pipeline[0].name).toBe('research');
    expect(pipeline[1].name).toBe('grade');
    expect(pipeline[2].name).toBe('fallback_research');
    expect(pipeline[3].name).toBe('fallback_grade');
    expect(pipeline[4].name).toBe('escalate');

    expect(pipeline[0].serviceId).toBe('svc_worker');
    expect(pipeline[1].serviceId).toBe('svc_litmus');
    expect(pipeline[4].serviceId).toBe('svc_summon');
  });

  it('escalate conditional fires if forceEscalation is true', () => {
    const pipeline = buildPipeline(config);
    const escalateStep = pipeline[4];

    const result = escalateStep.conditional!({
      topic: 'test',
      qualityThreshold: 80,
      forceEscalation: true,
      results: {},
    });

    expect(result).toBe(true);
  });

  it('escalate conditional fires if grade is below threshold', () => {
    const pipeline = buildPipeline(config);
    const escalateStep = pipeline[4];

    const result = escalateStep.conditional!({
      topic: 'test',
      qualityThreshold: 80,
      forceEscalation: false,
      results: { grade: { score: 75 } },
    });

    expect(result).toBe(true);
  });

  it('escalate conditional skips if grade is above threshold', () => {
    const pipeline = buildPipeline(config);
    const escalateStep = pipeline[4];

    const result = escalateStep.conditional!({
      topic: 'test',
      qualityThreshold: 80,
      forceEscalation: false,
      results: { grade: { score: 95 } },
    });

    expect(result).toBe(false);
  });

  it('evaluates research and grade buildRequirements correctly', () => {
    const pipeline = buildPipeline(config);
    const research = pipeline[0];
    const grade = pipeline[1];

    const rReq = research.buildRequirement({ topic: 'test_topic', qualityThreshold: 80, forceEscalation: false, results: {} });
    expect(rReq.topic).toBe('test_topic');
    expect(rReq.depth).toBe('comprehensive');

    const gReq = grade.buildRequirement({ 
      topic: 'test_topic', qualityThreshold: 80, forceEscalation: false, 
      results: { research: { draft: 'draft_content' } } 
    });
    expect(gReq.deliverable).toBe('draft_content');
    expect(gReq.context).toBe('Grading a research brief on: test_topic');
  });

  it('evaluates fallback_research and fallback_grade correctly', () => {
    const pipeline = buildPipeline({
      workerServiceId: 'svc_worker',
      workerFallbackServiceId: 'svc_fallback_worker',
      litmusServiceId: 'svc_litmus',
      summonServiceId: 'svc_summon',
    });

    const fallbackResearch = pipeline[2];
    const fallbackGrade = pipeline[3];

    // fallback_research conditional
    expect(fallbackResearch.conditional!({
      topic: 'test', qualityThreshold: 80, forceEscalation: false,
      results: { grade: { score: 70 } } // Low grade -> true
    })).toBe(true);

    expect(fallbackResearch.conditional!({
      topic: 'test', qualityThreshold: 80, forceEscalation: false,
      results: { grade: { score: 90 } } // High grade -> false
    })).toBe(false);

    // fallback_research buildRequirement
    const frReq = fallbackResearch.buildRequirement({
      topic: 'test_fallback', qualityThreshold: 80, forceEscalation: false, results: {}
    });
    expect(frReq.topic).toBe('test_fallback');
    expect(frReq.context).toContain('Fallback retry');

    // fallback_grade conditional
    expect(fallbackGrade.conditional!({
      topic: 'test', qualityThreshold: 80, forceEscalation: false,
      results: { fallback_research: { draft: 'xyz' } }
    })).toBe(true);
    
    expect(fallbackGrade.conditional!({
      topic: 'test', qualityThreshold: 80, forceEscalation: false,
      results: {} // Missing fallback_research
    })).toBe(false);

    // fallback_grade buildRequirement
    const fgReq = fallbackGrade.buildRequirement({
      topic: 'test_fg', qualityThreshold: 80, forceEscalation: false,
      results: { fallback_research: { draft: 'new_draft' } }
    });
    expect(fgReq.deliverable).toBe('new_draft');
    expect(fgReq.context).toContain('Grading fallback research brief on: test_fg');
  });

  it('evaluates escalate buildRequirement correctly with fallback grade', () => {
    const pipeline = buildPipeline(config);
    const escalateStep = pipeline[4];

    const req = escalateStep.buildRequirement({
      topic: 'escalate_topic',
      qualityThreshold: 80,
      forceEscalation: false,
      results: {
        fallback_grade: { score: 60, gaps: ['A gap'] }
      }
    });

    expect(req.prompt).toContain('escalate_topic');
    expect(req.prompt).toContain('60/100');
    expect(req.prompt).toContain('A gap');
  });

  it('skips fallback_research if workerFallbackServiceId is missing', () => {
    const pipeline = buildPipeline(config); // Missing fallback service ID
    const fallbackResearch = pipeline[2];

    expect(fallbackResearch.conditional!({
      topic: 'test', qualityThreshold: 80, forceEscalation: false,
      results: { grade: { score: 50 } } // Even if low grade, no fallback configured
    })).toBe(false);
  });
});

