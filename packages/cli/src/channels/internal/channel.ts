export class InternalChannel {
  type = "internal";
  fmt = {} as any;
  constructor(public name: string) {}
  async send() {}
  async sendOutput() {}
  clearLastMessage() {}
  async startReceiving(cb: any) {}
  stopReceiving() {}
  setTyping() {}
  drainEvents(chatId: string, since: number) { return []; }
  async routeInbound(msg: any) {}
  onPollAnswer: any;
}
