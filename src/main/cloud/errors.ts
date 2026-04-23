export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export class EntityDeletedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityDeletedError';
  }
}

export class CloudConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudConnectionError';
  }
}
