// for some reason, the slack api is missing from the repository. This is a placeholder to prevent errors when trying to use it.
export class SlackApi {
  constructor(token: string) {}
  async authTest() { return { user: "", team: "", user_id: "", team_id: "" }; }
}
