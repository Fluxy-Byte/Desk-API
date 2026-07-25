export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso não encontrado.") {
    super(message, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Sem permissão para executar esta ação.") {
    super(message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflito ao processar a requisição.", code?: string) {
    super(message, 409, code);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Dados inválidos.") {
    super(message, 422);
  }
}
