export interface BotCheck {
  verify(token: string, ip: string): Promise<boolean>;
}
