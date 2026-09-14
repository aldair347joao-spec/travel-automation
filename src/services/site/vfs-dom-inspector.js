"use strict";

/**
 * VFS DOM Inspector
 *
 * Este serviço NÃO tenta contornar mecanismos de segurança.
 *
 * Objetivo:
 * - observar o DOM real apresentado pelo VFS;
 * - identificar inputs e controles disponíveis;
 * - detectar possíveis campos de upload;
 * - identificar elementos relacionados com passaporte,
 *   documento, câmera, facial e OTP;
 * - fornecer diagnóstico para mapear o fluxo real.
 *
 * Não captura webcam.
 * Não simula liveness.
 * Não altera controles de segurança.
 */

const logger = require("../../utils/logger");

const MAX_TEXT_LENGTH = 5000;
const MAX_ELEMENTS = 500;

function truncate(value, max = 300) {
  const text = String(value || "");

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}...`;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

class VfsDomInspector {
  constructor(options = {}) {
    this.applicationId =
      options.applicationId || null;

    this.logger =
      options.logger || logger;
  }

  async inspect(page, options = {}) {
    if (!page) {
      throw new Error(
        "VFS DOM inspector requires a Puppeteer page"
      );
    }

    const includeHtml =
      options.includeHtml === true;

    const result =
      await page.evaluate(
        ({
          maxElements,
          maxTextLength,
          includeHtml: shouldIncludeHtml
        }) => {
          const normalize = value =>
            String(value || "")
              .replace(/\s+/g, " ")
              .trim();

          const truncate = (
            value,
            max = 300
          ) => {
            const text =
              String(value || "");

            return text.length <= max
              ? text
              : `${text.slice(0, max)}...`;
          };

          const getLabel = element => {
            if (!element) {
              return null;
            }

            const id =
              element.getAttribute("id");

            if (id) {
              const label =
                document.querySelector(
                  `label[for="${CSS.escape(id)}"]`
                );

              if (label) {
                return normalize(
                  label.innerText ||
                  label.textContent
                );
              }
            }

            const parentLabel =
              element.closest("label");

            if (parentLabel) {
              return normalize(
                parentLabel.innerText ||
                parentLabel.textContent
              );
            }

            return null;
          };

          const getAttributes =
            element => {
              const attributes = {};

              for (
                const attribute of
                Array.from(
                  element.attributes || []
                )
              ) {
                attributes[
                  attribute.name
                ] =
                  truncate(
                    attribute.value,
                    500
                  );
              }

              return attributes;
            };

          const getElementInfo =
            element => {
              const rect =
                element.getBoundingClientRect();

              const style =
                window.getComputedStyle(
                  element
                );

              return {
                tag:
                  element.tagName
                    ?.toLowerCase() ||
                  null,

                type:
                  element.getAttribute(
                    "type"
                  ) || null,

                id:
                  element.id ||
                  null,

                name:
                  element.getAttribute(
                    "name"
                  ) || null,

                role:
                  element.getAttribute(
                    "role"
                  ) || null,

                ariaLabel:
                  element.getAttribute(
                    "aria-label"
                  ) || null,

                placeholder:
                  element.getAttribute(
                    "placeholder"
                  ) || null,

                autocomplete:
                  element.getAttribute(
                    "autocomplete"
                  ) || null,

                accept:
                  element.getAttribute(
                    "accept"
                  ) || null,

                required:
                  element.hasAttribute(
                    "required"
                  ),

                disabled:
                  element.hasAttribute(
                    "disabled"
                  ) ||
                  element.disabled === true,

                readonly:
                  element.hasAttribute(
                    "readonly"
                  ),

                visible:
                  Boolean(
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !==
                      "hidden" &&
                    style.display !==
                      "none"
                  ),

                label:
                  getLabel(element),

                text:
                  truncate(
                    normalize(
                      element.innerText ||
                      element.textContent
                    ),
                    500
                  ),

                value:
                  element.tagName ===
                    "INPUT" &&
                  element.type !==
                    "password" &&
                  element.type !==
                    "file"
                    ? truncate(
                        element.value,
                        300
                      )
                    : null,

                attributes:
                  getAttributes(
                    element
                  )
              };
            };

          const allElements =
            Array.from(
              document.querySelectorAll(
                "input, select, textarea, button, [role='button'], [role='textbox'], [role='combobox'], video, canvas, iframe"
              )
            ).slice(
              0,
              maxElements
            );

          const elements =
            allElements.map(
              getElementInfo
            );

          const fileInputs =
            elements.filter(
              element =>
                element.tag ===
                  "input" &&
                element.type ===
                  "file"
            );

          const cameraElements =
            elements.filter(
              element => {
                const combined =
                  [
                    element.tag,
                    element.type,
                    element.id,
                    element.name,
                    element.role,
                    element.ariaLabel,
                    element.placeholder,
                    element.label,
                    element.text,
                    element.accept
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                return (
                  combined.includes(
                    "camera"
                  ) ||
                  combined.includes(
                    "webcam"
                  ) ||
                  combined.includes(
                    "face"
                  ) ||
                  combined.includes(
                    "facial"
                  ) ||
                  combined.includes(
                    "liveness"
                  ) ||
                  combined.includes(
                    "selfie"
                  )
                );
              }
            );

          const passportElements =
            elements.filter(
              element => {
                const combined =
                  [
                    element.tag,
                    element.type,
                    element.id,
                    element.name,
                    element.role,
                    element.ariaLabel,
                    element.placeholder,
                    element.label,
                    element.text,
                    element.accept
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                return (
                  combined.includes(
                    "passport"
                  ) ||
                  combined.includes(
                    "travel document"
                  ) ||
                  combined.includes(
                    "document number"
                  ) ||
                  combined.includes(
                    "passport number"
                  )
                );
              }
            );

          const otpElements =
            elements.filter(
              element => {
                const combined =
                  [
                    element.tag,
                    element.type,
                    element.id,
                    element.name,
                    element.role,
                    element.ariaLabel,
                    element.placeholder,
                    element.label,
                    element.text
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                return (
                  combined.includes(
                    "otp"
                  ) ||
                  combined.includes(
                    "one time password"
                  ) ||
                  combined.includes(
                    "verification code"
                  ) ||
                  combined.includes(
                    "verification code"
                  )
                );
              }
            );

          const buttons =
            elements.filter(
              element =>
                element.tag ===
                  "button" ||
                element.role ===
                  "button"
            );

          const selects =
            elements.filter(
              element =>
                element.tag ===
                "select"
            );

          const visibleText =
            normalize(
              document.body?.innerText ||
              ""
            );

          const bodyText =
            truncate(
              visibleText,
              maxTextLength
            );

          const iframes =
            Array.from(
              document.querySelectorAll(
                "iframe"
              )
            ).map(
              iframe => ({
                src:
                  iframe.getAttribute(
                    "src"
                  ) || null,

                title:
                  iframe.getAttribute(
                    "title"
                  ) || null,

                name:
                  iframe.getAttribute(
                    "name"
                  ) || null,

                visible:
                  (() => {
                    const rect =
                      iframe.getBoundingClientRect();

                    return (
                      rect.width > 0 &&
                      rect.height > 0
                    );
                  })()
              })
            );

          const videos =
            Array.from(
              document.querySelectorAll(
                "video"
              )
            ).map(
              video => ({
                id:
                  video.id ||
                  null,

                autoplay:
                  video.autoplay,

                playsInline:
                  video.playsInline,

                muted:
                  video.muted,

                width:
                  video.videoWidth ||
                  null,

                height:
                  video.videoHeight ||
                  null
              })
            );

          const canvases =
            Array.from(
              document.querySelectorAll(
                "canvas"
              )
            ).map(
              canvas => ({
                id:
                  canvas.id ||
                  null,

                width:
                  canvas.width,

                height:
                  canvas.height
              })
            );

          return {
            url:
              window.location.href,

            title:
              document.title,

            stateHint:
              document.body?.getAttribute(
                "data-state"
              ) || null,

            bodyText,

            elementCount:
              allElements.length,

            elements,

            fileInputs,

            passportElements,

            cameraElements,

            otpElements,

            buttons,

            selects,

            iframes,

            videos,

            canvases,

            html:
              shouldIncludeHtml
                ? document.documentElement.outerHTML.slice(
                    0,
                    50000
                  )
                : null
          };
        },
        {
          maxElements:
            MAX_ELEMENTS,

          maxTextLength:
            MAX_TEXT_LENGTH,

          includeHtml
        }
      );

    const summary =
      this.buildSummary(result);

    const inspection = {
      success: true,

      applicationId:
        this.applicationId,

      inspectedAt:
        new Date().toISOString(),

      ...result,

      summary
    };

    this.logInspection(
      inspection
    );

    return inspection;
  }

  buildSummary(result) {
    const fileInputs =
      Array.isArray(
        result.fileInputs
      )
        ? result.fileInputs
        : [];

    const passportElements =
      Array.isArray(
        result.passportElements
      )
        ? result.passportElements
        : [];

    const cameraElements =
      Array.isArray(
        result.cameraElements
      )
        ? result.cameraElements
        : [];

    const otpElements =
      Array.isArray(
        result.otpElements
      )
        ? result.otpElements
        : [];

    const videos =
      Array.isArray(
        result.videos
      )
        ? result.videos
        : [];

    return {
      hasFileUpload:
        fileInputs.length > 0,

      fileUploadCount:
        fileInputs.length,

      fileUploadAccepts:
        fileInputs.map(
          input =>
            input.accept || null
        ),

      hasPassportField:
        passportElements.length > 0,

      passportFieldCount:
        passportElements.length,

      hasCameraRelatedElement:
        cameraElements.length > 0,

      cameraElementCount:
        cameraElements.length,

      hasOtpField:
        otpElements.length > 0,

      otpElementCount:
        otpElements.length,

      hasVideo:
        videos.length > 0,

      iframeCount:
        Array.isArray(
          result.iframes
        )
          ? result.iframes.length
          : 0
    };
  }

  logInspection(
    inspection
  ) {
    const summary =
      inspection.summary || {};

    this.logger.info(
      "VFS DOM inspection completed",
      {
        applicationId:
          this.applicationId,

        url:
          inspection.url,

        hasFileUpload:
          summary.hasFileUpload,

        fileUploadCount:
          summary.fileUploadCount,

        fileUploadAccepts:
          summary.fileUploadAccepts,

        hasPassportField:
          summary.hasPassportField,

        hasCameraRelatedElement:
          summary.hasCameraRelatedElement,

        hasOtpField:
          summary.hasOtpField
      }
    );
  }

  async inspectAndReturn(page) {
    try {
      return await this.inspect(
        page
      );
    } catch (error) {
      this.logger.error(
        "VFS DOM inspection failed",
        {
          applicationId:
            this.applicationId,

          error:
            error.message,

          stack:
            error.stack
        }
      );

      return {
        success: false,

        applicationId:
          this.applicationId,

        error:
          error.message
      };
    }
  }
}

module.exports =
  VfsDomInspector;
