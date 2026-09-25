function publicErrorResponse(error) {
  if (error?.type === "entity.parse.failed") {
    return { status: 400, message: "Invalid JSON body" };
  }

  if (error?.type === "entity.too.large") {
    return { status: 413, message: "Request body too large" };
  }

  const requestedStatus = Number(error?.status || error?.statusCode);

  if (
    Number.isInteger(requestedStatus) &&
    requestedStatus >= 400 &&
    requestedStatus < 500
  ) {
    if (requestedStatus === 413) {
      return { status: 413, message: "Request body too large" };
    }

    if (requestedStatus === 415) {
      return { status: 415, message: "Unsupported request body" };
    }

    return { status: requestedStatus, message: "Invalid request" };
  }

  return { status: 500, message: "Internal server error" };
}

function notFoundHandler(req, res) {
  res.status(404).json({ message: "Route not found" });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const response = publicErrorResponse(error);

  if (response.status >= 500) {
    // Keep diagnostics server-side without returning stack traces or messages.
    console.error(
      `Unhandled request error: ${error?.name || "UnknownError"}`
    );
  }

  return res.status(response.status).json({ message: response.message });
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler;
module.exports.notFoundHandler = notFoundHandler;
