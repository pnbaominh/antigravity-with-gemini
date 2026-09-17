import fs from 'node:fs';
import path from 'node:path';
import {
  GovernancePlanSchema,
  RuleValidationResult,
  PERTEstimate,
  WBSNode,
  AsIsEvidence,
  RAIDItem,
} from './types.js';

export class RulesEngine {
  private static readonly EPSILON = 0.05; // Precision variance tolerance

  public static calculatePERT(O: number, M: number, P: number): PERTEstimate {
    if (O < 0 || M < O || P < M) {
      throw new Error(`Invalid PERT bounds: O=${O}, M=${M}, P=${P}. Must satisfy 0 <= O <= M <= P.`);
    }
    const expectedHours = Number(((O + 4 * M + P) / 6).toFixed(2));
    const sigmaHours = Number(((P - O) / 6).toFixed(2));
    return {
      optimisticHours: O,
      mostLikelyHours: M,
      pessimisticHours: P,
      expectedHours,
      sigmaHours,
    };
  }

  public static calculateTotalPERT(nodes: WBSNode[]): PERTEstimate {
    let totalO = 0;
    let totalM = 0;
    let totalP = 0;
    let varianceSum = 0;

    for (const node of nodes) {
      const { optimisticHours, mostLikelyHours, pessimisticHours, sigmaHours } = node.estimatedHours;
      totalO += optimisticHours;
      totalM += mostLikelyHours;
      totalP += pessimisticHours;
      varianceSum += Math.pow(sigmaHours, 2);
    }

    const expectedHours = Number(((totalO + 4 * totalM + totalP) / 6).toFixed(2));
    const sigmaHours = Number(Math.sqrt(varianceSum).toFixed(2));

    return {
      optimisticHours: totalO,
      mostLikelyHours: totalM,
      pessimisticHours: totalP,
      expectedHours,
      sigmaHours,
    };
  }

  public static validatePlan(
    plan: GovernancePlanSchema,
    workspaceRoot?: string
  ): RuleValidationResult {
    const violations: string[] = [];

    // 1. Halt-on-Unknown Axiom Check
    if (plan.haltOnUnknownTriggered || (plan.unknownsList && plan.unknownsList.length > 0)) {
      return {
        valid: false,
        violations: [
          `Halt-on-Unknown triggered with ${plan.unknownsList?.length || 1} unverified items: ${plan.unknownsList?.join('; ') || 'Critical unknown encountered.'}`,
        ],
        haltRequired: true,
      };
    }

    // 2. Non-Goals Axiom Check (Min 3)
    if (!plan.nonGoals || plan.nonGoals.length < 3) {
      violations.push(
        `Non-Goals invariant violated: Expected at least 3 non-goals, found ${plan.nonGoals?.length ?? 0}.`
      );
    }

    // 3. Grounding Evidence AS-IS Verification
    if (!plan.asIsEvidence || plan.asIsEvidence.length === 0) {
      violations.push('AS-IS Evidence invariant violated: Plan lacks grounded context evidence.');
    } else if (workspaceRoot) {
      for (const evidence of plan.asIsEvidence) {
        const fullPath = path.resolve(workspaceRoot, evidence.filePath);
        if (!fs.existsSync(fullPath)) {
          violations.push(`AS-IS Evidence error: Referenced grounded file does not exist: ${evidence.filePath}`);
        }
      }
    }

    // 4. WBS 8/80 & Single DRI & Binary AC Checks
    if (!plan.wbsNodes || plan.wbsNodes.length === 0) {
      violations.push('WBS invariant violated: Plan must contain at least 1 WBS task node.');
    } else {
      for (const node of plan.wbsNodes) {
        if (!node.dri || node.dri.trim() === '') {
          violations.push(`WBS Task [${node.id}] violates Single DRI rule: DRI is missing or empty.`);
        }

        if (!node.binaryAcceptanceCriteria || node.binaryAcceptanceCriteria.length === 0) {
          violations.push(
            `WBS Task [${node.id}] violates Binary AC rule: No pass/fail acceptance criteria defined.`
          );
        }

        const pert = node.estimatedHours;
        if (pert) {
          if (pert.expectedHours < 0.5 || pert.expectedHours > 80) {
            violations.push(
              `WBS Task [${node.id}] violates 8/80 Rule: Expected hours (${pert.expectedHours}h) outside 0.5h - 80h bound.`
            );
          }

          // PERT Math validation
          const calculatedExpected = (pert.optimisticHours + 4 * pert.mostLikelyHours + pert.pessimisticHours) / 6;
          if (Math.abs(calculatedExpected - pert.expectedHours) > this.EPSILON) {
            violations.push(
              `WBS Task [${node.id}] has invalid PERT Expected calculation: Given ${pert.expectedHours}, Calculated ${calculatedExpected.toFixed(2)}`
            );
          }
        } else {
          violations.push(`WBS Task [${node.id}] missing PERT estimation.`);
        }
      }
    }

    // 5. RAID Log Completeness
    if (!plan.raidLog || plan.raidLog.length === 0) {
      violations.push('RAID Log invariant violated: Pre-Mortem analysis requires at least 1 RAID log entry.');
    } else {
      for (const item of plan.raidLog) {
        if (!item.ownerDRI || item.ownerDRI.trim() === '') {
          violations.push(`RAID item [${item.id}] must have an assigned ownerDRI.`);
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      haltRequired: false,
    };
  }

  public static parseMarkdownPlan(markdown: string): GovernancePlanSchema {
    // 1. Title
    const titleMatch = markdown.match(/^# (?:Plan:\s*)?(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled Implementation Plan";

    // 2. DRI (Global plan DRI)
    const driMatch = markdown.match(/(?:^|\n)(?:DRI|Lead|Owner):\s*([^\n]+)/i);
    const planDri = driMatch ? driMatch[1].trim() : "@lead_architect";

    // 3. AS-IS Evidence
    const asIsSectionMatch = markdown.match(/## [^\n]*(?:AS-IS|Evidence|Grounding)[\s\S]*?(?=\n## |$)/i);
    const asIsEvidence: AsIsEvidence[] = [];
    if (asIsSectionMatch) {
      const lines = asIsSectionMatch[0].split('\n');
      for (const line of lines) {
        const fileMatch = line.match(/`([^`]+\.[a-zA-Z0-9_-]+)`(?::?\s*(.*))?/);
        if (fileMatch) {
          asIsEvidence.push({
            filePath: fileMatch[1].trim(),
            observation: fileMatch[2]?.trim() || "Referenced in plan grounding evidence",
          });
        }
      }
    }

    // 4. Non-Goals
    const nonGoalsSectionMatch = markdown.match(/## [^\n]*Non-Goals[\s\S]*?(?=\n## |$)/i);
    const nonGoals: string[] = [];
    if (nonGoalsSectionMatch) {
      const lines = nonGoalsSectionMatch[0].split('\n');
      for (const line of lines) {
        const match = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
        if (match) {
          const text = match[1].trim();
          if (!text.toLowerCase().includes("non-goals") && !text.toLowerCase().includes("mandatory")) {
            nonGoals.push(text);
          }
        }
      }
    }

    // 5. Halt on Unknown
    let haltOnUnknownTriggered = false;
    const unknownsList: string[] = [];
    const unknownsSectionMatch = markdown.match(/## [^\n]*Unknowns?[\s\S]*?(?=\n## |$)/i);
    if (unknownsSectionMatch) {
      const text = unknownsSectionMatch[0];
      if (/status:\s*halt/i.test(text) || /halt on unknown/i.test(text)) {
        haltOnUnknownTriggered = true;
      }
      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
        if (match) {
          const item = match[1].trim();
          if (!item.toLowerCase().includes("none") && !item.toLowerCase().includes("(none)") && !item.toLowerCase().includes("status:")) {
            unknownsList.push(item);
            haltOnUnknownTriggered = true;
          }
        }
      }
    } else if (/halt on unknown/i.test(markdown)) {
      haltOnUnknownTriggered = true;
      unknownsList.push("Halt on Unknown declared in plan text.");
    }

    // 6. RAID Log
    const raidLog: RAIDItem[] = [];
    const raidSectionMatch = markdown.match(/## [^\n]*(?:RAID|Pre-Mortem)[\s\S]*?(?=\n## |$)/i);
    if (raidSectionMatch) {
      const lines = raidSectionMatch[0].split('\n');
      for (const line of lines) {
        if (line.includes('|') && !line.includes('---') && !line.toLowerCase().includes('category')) {
          const parts = line.split('|').map(p => p.trim()).filter(Boolean);
          if (parts.length >= 6) {
            const cat = parts[1] as any;
            raidLog.push({
              id: parts[0],
              category: ['Risk', 'Assumption', 'Issue', 'Dependency'].includes(cat) ? cat : 'Risk',
              description: parts[2],
              impact: (parts[3] as any) || 'Medium',
              likelihood: (parts[4] as any) || 'Medium',
              mitigationStrategy: parts[5],
              ownerDRI: parts[6] || planDri,
            });
          }
        } else {
          const bulletMatch = line.match(/^[-*]\s*\[?(Risk|Assumption|Issue|Dependency)\]?:?\s*(.+)/i);
          if (bulletMatch) {
            const cat = (bulletMatch[1].charAt(0).toUpperCase() + bulletMatch[1].slice(1).toLowerCase()) as any;
            const desc = bulletMatch[2].trim();
            const driInDesc = desc.match(/(?:DRI|Owner):\s*([@\w.-]+)/i);
            raidLog.push({
              id: `RAID-${raidLog.length + 1}`,
              category: cat,
              description: desc,
              impact: 'Medium',
              likelihood: 'Medium',
              mitigationStrategy: 'Documented in architectural pre-mortem',
              ownerDRI: driInDesc ? driInDesc[1] : planDri,
            });
          }
        }
      }
    }

    // 7. WBS Nodes / Phases
    const wbsNodes: WBSNode[] = [];
    const phaseRegex = /(?:###|##)\s*(?:Phase|WBS)\s*(\d+[:.]?\s*[^\n]+)([\s\S]*?)(?=(?:###|##)\s*(?:Phase|WBS)|\n##\s+[^\n]+|$)/gi;
    let phaseMatch: RegExpExecArray | null;
    while ((phaseMatch = phaseRegex.exec(markdown)) !== null) {
      const phaseId = phaseMatch[1].trim();
      const phaseContent = phaseMatch[2];

      const tasks: string[] = [];
      const taskRegex = /- \[ \]\s*([^\n]+)/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = taskRegex.exec(phaseContent)) !== null) {
        tasks.push(tMatch[1].trim());
      }

      const verifMatch = phaseContent.match(/\*\*Verification:\*\*\s*([^\n]+)/i);
      const verif = verifMatch ? [verifMatch[1].trim()] : [];

      let pert: PERTEstimate = RulesEngine.calculatePERT(2, 4, 6);
      const pertMatch = phaseContent.match(/PERT:\s*O=(\d+(?:\.\d+)?),\s*M=(\d+(?:\.\d+)?),\s*P=(\d+(?:\.\d+)?)/i);
      if (pertMatch) {
        try {
          pert = RulesEngine.calculatePERT(
            parseFloat(pertMatch[1]),
            parseFloat(pertMatch[2]),
            parseFloat(pertMatch[3])
          );
        } catch {}
      }

      const driInPhaseMatch = phaseContent.match(/DRI:\s*([@\w.-]+)/i);
      const phaseDri = driInPhaseMatch ? driInPhaseMatch[1] : planDri;

      if (tasks.length > 0) {
        for (let i = 0; i < tasks.length; i++) {
          const taskText = tasks[i];
          const taskDriMatch = taskText.match(/(?:DRI|Owner):\s*([@\w.-]+)/i);
          wbsNodes.push({
            id: `WBS-${phaseId}-${i + 1}`,
            title: taskText,
            dri: taskDriMatch ? taskDriMatch[1] : phaseDri,
            estimatedHours: pert,
            dependencies: [],
            binaryAcceptanceCriteria: verif.length > 0 ? verif : ['Pass/fail verification command'],
            isCompleted: false,
          });
        }
      } else {
        wbsNodes.push({
          id: `WBS-${phaseId}`,
          title: phaseId,
          dri: phaseDri,
          estimatedHours: pert,
          dependencies: [],
          binaryAcceptanceCriteria: verif.length > 0 ? verif : ['Pass/fail verification command'],
          isCompleted: false,
        });
      }
    }

    // 8. Definition of Done
    const dod: string[] = [];
    const dodSectionMatch = markdown.match(/## [^\n]*(?:Acceptance Criteria|Definition of Done|Quality Gates)[\s\S]*?(?=\n## |$)/i);
    if (dodSectionMatch) {
      const lines = dodSectionMatch[0].split('\n');
      for (const line of lines) {
        const match = line.match(/^(?:[-*]|- \[[ x]\])\s+(.+)$/);
        if (match) {
          dod.push(match[1].trim());
        }
      }
    }

    return {
      planId: `PLAN-${Date.now().toString(36)}`,
      title,
      dri: planDri,
      asIsEvidence,
      nonGoals: nonGoals as any,
      haltOnUnknownTriggered,
      unknownsList,
      raidLog,
      wbsNodes,
      definitionOfDone: dod.length > 0 ? dod : ['Zero build errors', '100% test pass rate'],
    };
  }

  public static validateMarkdownPlan(
    markdown: string,
    workspaceRoot?: string
  ): RuleValidationResult {
    const planSchema = RulesEngine.parseMarkdownPlan(markdown);
    return RulesEngine.validatePlan(planSchema, workspaceRoot);
  }
}
