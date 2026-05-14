export class Position {
  constructor(public line: number, public character: number) {}
}

export const workspace = {
  getConfiguration: (_section: string) => ({
    get: <T>(_key: string, defaultValue: T): T => defaultValue,
  }),
};
