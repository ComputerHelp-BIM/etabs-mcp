using System;

namespace EtabsBridge.Core
{
    /// <summary>An ETABS API call returned a non-zero status or threw.</summary>
    public sealed class EtabsApiException : Exception
    {
        public EtabsApiException(string apiCall, int returnCode)
            : base($"ETABS API call '{apiCall}' failed with return code {returnCode}.")
        {
            ApiCall = apiCall;
            ReturnCode = returnCode;
        }

        public EtabsApiException(string apiCall, string message, Exception? inner = null)
            : base($"ETABS API call '{apiCall}' failed: {message}", inner)
        {
            ApiCall = apiCall;
        }

        /// <summary>The API member that failed, e.g. "FrameObj.GetAllFrames".</summary>
        public string ApiCall { get; }

        /// <summary>The non-zero return code, or null when the call threw.</summary>
        public int? ReturnCode { get; }

        /// <summary>Throws when an ETABS API return code signals failure (anything but 0).</summary>
        public static void Check(int returnCode, string apiCall)
        {
            if (returnCode != 0)
            {
                throw new EtabsApiException(apiCall, returnCode);
            }
        }
    }

    /// <summary>A request-level error with an HTTP status and a stable machine-readable code.</summary>
    public sealed class BridgeException : Exception
    {
        public BridgeException(int status, string code, string message)
            : base(message)
        {
            Status = status;
            Code = code;
        }

        public int Status { get; }

        /// <summary>Stable error code, see <see cref="ErrorCodes"/>.</summary>
        public string Code { get; }
    }

    /// <summary>Error codes returned in <c>{"error":{"code":...}}</c>. Part of the API contract.</summary>
    public static class ErrorCodes
    {
        public const string BadRequest = "BAD_REQUEST";
        public const string Unauthorized = "UNAUTHORIZED";
        public const string ForbiddenOrigin = "FORBIDDEN_ORIGIN";
        public const string ForbiddenHost = "FORBIDDEN_HOST";
        public const string WriteDisabled = "WRITE_DISABLED";
        public const string NotFound = "NOT_FOUND";
        public const string MethodNotAllowed = "METHOD_NOT_ALLOWED";
        public const string PayloadTooLarge = "PAYLOAD_TOO_LARGE";
        public const string EtabsApiError = "ETABS_API_ERROR";
        public const string EtabsBusy = "ETABS_BUSY";
        public const string Internal = "INTERNAL";
    }
}
