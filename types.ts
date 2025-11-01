export enum MessageRole {
  USER = 'user',
  MODEL = 'model',
  ERROR = 'error',
}

export interface Message {
  role: MessageRole;
  content: string;
  imageUrl?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}