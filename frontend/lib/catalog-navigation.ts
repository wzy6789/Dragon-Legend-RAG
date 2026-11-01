import type { BenchmarkQuestion, ResearchSystem } from "./types";

export function filterSystems(systems: ResearchSystem[], query = "", tier = "all", status = "all") {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return systems.filter(system => {
    if (tier !== "all" && !system.tiers.includes(tier)) return false;
    if (status !== "all" && system.status !== status) return false;
    const text = [system.id,system.label,system.family,system.version,system.variant,system.notes].join(" ").toLocaleLowerCase();
    return tokens.every(token => text.includes(token));
  });
}
export function filterQuestions(questions: BenchmarkQuestion[], query = "", type = "all", availableOnly = false) {
  const text = query.trim().toLocaleLowerCase();
  const number = /^(?:q|第)?0*(\d+)(?:题)?$/i.exec(text)?.[1];
  return questions.filter(question => {
    if (type !== "all" && question.type !== type) return false;
    if (availableOnly && question.runnable === false) return false;
    if (number) return String(question.id).replace(/^q0*/i, "").replace(/^0+/, "") === number;
    const haystack = `${question.id} ${question.question} ${question.type ?? ""}`.toLocaleLowerCase();
    return text.split(/\s+/).every(token=>haystack.includes(token));
  });
}
