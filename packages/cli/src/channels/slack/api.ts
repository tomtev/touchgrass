export class SlackApi {
  constructor(token: string) {}
  async authTest() { return { user: "", team: "", user_id: "", team_id: "" }; }
}
