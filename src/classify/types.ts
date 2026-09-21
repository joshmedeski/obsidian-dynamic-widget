export interface Candidate {
  id: string;
  label: string;
  aliases: string[];
  summary: string;
  parents: string[];
}

export interface Subject {
  id: string;
  text: string;
  title: string;
}

export interface Choice {
  candidateId: string;
  score: number;
  rationale: string;
}

export interface Decision {
  subjectId: string;
  choices: Choice[];
  abstained: boolean;
  strategy: string;
}

export interface Strategy {
  readonly name: string;
  rank(subject: Subject, candidates: readonly Candidate[]): Choice[];
}
