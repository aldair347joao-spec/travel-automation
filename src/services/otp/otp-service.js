"use strict";

const crypto = require("crypto");

const {
  getCredentialsForAutomation
} = require("../admin/admin-control-service");


/*
 * =========================================================
 * CONFIGURAÇÃO
 * =========================================================
 */

function toBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return [
    "true",
    "1",
    "yes",
    "on"
  ].includes(
    String(value)
      .trim()
      .toLowerCase()
  );
}


function toPositiveNumber(
  value,
  fallback
) {
  const number =
    Number(value);

  return Number.isFinite(number) &&
    number > 0
    ? number
    : fallback;
}


/*
 * =========================================================
 * OTP SERVICE
 * =========================================================
 *
 * Responsabilidades:
 *
 * 1. Criar uma solicitação OTP por candidatura.
 *
 * 2. Obter as credenciais VFS da candidatura através
 *    do controlo administrativo.
 *
 * 3. Usar o e-mail configurado pela Administração como
 *    caixa de entrada do OTP.
 *
 * 4. Procurar automaticamente mensagens recentes.
 *
 * 5. Extrair um código OTP de 4 a 8 dígitos.
 *
 * 6. Ignorar mensagens antigas anteriores à solicitação.
 *
 * 7. Não usar application.client.email.
 *
 * 8. Não usar credenciais VFS globais.
 *
 * 9. Não interagir com CAPTCHA ou outros checkpoints
 *    oficiais de segurança.
 *
 * =========================================================
 */

class OtpService {

  constructor() {

    this.enabled =
      toBoolean(
        process.env.OTP_ENABLED,
        false
      );

    this.testMode =
      toBoolean(
        process.env.OTP_TEST_MODE,
        false
      );

    this.testCode =
      process.env.OTP_TEST_CODE ||
      null;


    /*
     * Tempo máximo durante o qual o OTP continua válido.
     */

    const ttlSeconds =
      Number(
        process.env.OTP_TTL_SECONDS
      );

    const ttlMs =
      Number(
        process.env.OTP_TTL_MS
      );

    this.ttlMs =
      Number.isFinite(
        ttlSeconds
      ) &&
      ttlSeconds > 0
        ? ttlSeconds * 1000
        : Number.isFinite(
            ttlMs
          ) &&
          ttlMs > 0
          ? ttlMs
          : 5 * 60 * 1000;


    this.maxAttempts =
      toPositiveNumber(
        process.env.OTP_MAX_ATTEMPTS,
        5
      );


    /*
     * Intervalo entre consultas da caixa de entrada.
     */

    this.pollIntervalMs =
      toPositiveNumber(
        process.env.OTP_EMAIL_POLL_INTERVAL_MS,
        3000
      );


    /*
     * Número máximo de mensagens analisadas
     * por consulta.
     */

    this.maxMessagesPerPoll =
      toPositiveNumber(
        process.env.OTP_EMAIL_MAX_MESSAGES,
        20
      );


    /*
     * Janela máxima para procurar mensagens.
     *
     * O padrão é ligeiramente maior que o TTL.
     */

    this.searchWindowMs =
      toPositiveNumber(
        process.env.OTP_EMAIL_SEARCH_WINDOW_MS,
        Math.max(
          this.ttlMs,
          10 * 60 * 1000
        )
      );


    /*
     * IMAP.
     *
     * Se OTP_IMAP_HOST não estiver definido,
     * o serviço tenta determinar automaticamente
     * o servidor pelo domínio do e-mail.
     */

    this.imapHost =
      process.env.OTP_IMAP_HOST ||
      null;

    this.imapPort =
      Number(
        process.env.OTP_IMAP_PORT
      ) || 993;

    this.imapSecure =
      process.env.OTP_IMAP_SECURE ===
        undefined
        ? true
        : toBoolean(
            process.env.OTP_IMAP_SECURE,
            true
          );


    this.imapMailbox =
      process.env.OTP_IMAP_MAILBOX ||
      "INBOX";


    /*
     * Em alguns provedores o endereço VFS pode ser
     * a mesma conta usada para receber o OTP.
     *
     * Por padrão usamos as credenciais administrativas
     * VFS armazenadas de forma encriptada.
     */

    this.emailUserFromVfs =
      process.env.OTP_EMAIL_USE_VFS_CREDENTIALS ===
        undefined
        ? true
        : toBoolean(
            process.env.OTP_EMAIL_USE_VFS_CREDENTIALS,
            true
          );


    /*
     * Remetentes opcionais.
     *
     * Exemplo:
     *
     * OTP_EMAIL_ALLOWED_SENDERS=vfs@vfsglobal.com,no-reply@vfsglobal.com
     *
     * Se vazio, não restringimos pelo remetente.
     */

    this.allowedSenders =
      String(
        process.env.OTP_EMAIL_ALLOWED_SENDERS ||
        ""
      )
        .split(",")
        .map(
          value =>
            value
              .trim()
              .toLowerCase()
        )
        .filter(
          Boolean
        );


    /*
     * Expressões para identificar OTP.
     *
     * A ordem importa.
     */

    this.codePatterns = [

      /*
       * "Your OTP is 123456"
       */

      /\b(?:otp|one[\s-]*time[\s-]*password|verification\s+code|security\s+code|confirmation\s+code|authentication\s+code)\D{0,40}(\d{4,8})\b/i,

      /*
       * "code: 123456"
       */

      /\b(?:code|c[oó]digo|codigo)\D{0,20}(\d{4,8})\b/i,

      /*
       * "123456 is your verification code"
       */

      /\b(\d{4,8})\b[\s\S]{0,40}(?:otp|verification|security|confirmation|authentication)\b/i
    ];
  }


  /*
   * =======================================================
   * DEPENDÊNCIAS OPCIONAIS
   * =======================================================
   *
   * Fazemos require apenas quando o leitor real é usado.
   *
   * Isso permite que o servidor continue iniciando enquanto
   * as dependências ainda não foram adicionadas ao package.
   */

  loadEmailDependencies() {

    let ImapFlow;
    let simpleParser;

    try {

      const imapflow =
        require("imapflow");

      ImapFlow =
        imapflow.ImapFlow;

    } catch (
      error
    ) {

      const dependencyError =
        new Error(
          "A dependência imapflow não está instalada. Instale imapflow antes de ativar o OTP por e-mail."
        );

      dependencyError.code =
        "OTP_IMAPFLOW_MISSING";

      dependencyError.cause =
        error;

      throw dependencyError;
    }


    try {

      const mailparser =
        require("mailparser");

      simpleParser =
        mailparser.simpleParser;

    } catch (
      error
    ) {

      const dependencyError =
        new Error(
          "A dependência mailparser não está instalada. Instale mailparser antes de ativar o OTP por e-mail."
        );

      dependencyError.code =
        "OTP_MAILPARSER_MISSING";

      dependencyError.cause =
        error;

      throw dependencyError;
    }


    return {
      ImapFlow,
      simpleParser
    };
  }


  /*
   * =======================================================
   * REQUEST
   * =======================================================
   */

  createRequest(
    applicationId
  ) {

    if (
      !applicationId
    ) {

      throw new Error(
        "applicationId is required"
      );
    }


    const requestId =
      crypto.randomUUID();


    const now =
      new Date();


    const expiresAt =
      new Date(
        now.getTime() +
        this.ttlMs
      );


    return {

      requestId,

      applicationId:

        String(
          applicationId
        ),

      createdAt:
        now,

      expiresAt,

      status:
        "waiting"
    };
  }


  /*
   * =======================================================
   * NORMALIZAÇÃO DE E-MAIL
   * =======================================================
   */

  normalizeEmail(
    value
  ) {

    if (
      !value
    ) {

      return null;
    }

    return String(
      value
    )
      .trim()
      .toLowerCase();
  }


  /*
   * =======================================================
   * DOMÍNIO
   * =======================================================
   */

  getDomain(
    email
  ) {

    const normalized =
      this.normalizeEmail(
        email
      );

    if (
      !normalized ||
      !normalized.includes("@")
    ) {

      return null;
    }

    return normalized
      .split("@")
      .pop();
  }


  /*
   * =======================================================
   * IMAP AUTO DISCOVERY
   * =======================================================
   *
   * Quando o administrador não definir
   * OTP_IMAP_HOST, usamos provedores conhecidos.
   *
   * Para outros provedores, OTP_IMAP_HOST deve ser
   * definido no Render.
   */

  resolveImapHost(
    email
  ) {

    if (
      this.imapHost
    ) {

      return this.imapHost;
    }


    const domain =
      this.getDomain(
        email
      );


    const knownHosts = {

      "gmail.com":
        "imap.gmail.com",

      "googlemail.com":
        "imap.gmail.com",

      "outlook.com":
        "outlook.office365.com",

      "hotmail.com":
        "outlook.office365.com",

      "hotmail.co.uk":
        "outlook.office365.com",

      "live.com":
        "outlook.office365.com",

      "msn.com":
        "outlook.office365.com",

      "yahoo.com":
        "imap.mail.yahoo.com",

      "yahoo.co.uk":
        "imap.mail.yahoo.com",

      "icloud.com":
        "imap.mail.me.com",

      "me.com":
        "imap.mail.me.com",

      "aol.com":
        "imap.aol.com"
    };


    return (
      knownHosts[
        domain
      ] ||
      null
    );
  }


  /*
   * =======================================================
   * CREDENCIAIS DA CAIXA DE ENTRADA
   * =======================================================
   *
   * IMPORTANTE:
   *
   * Não usamos:
   *
   * application.client.email
   *
   * nem:
   *
   * OTP_EMAIL
   *
   * como destino principal.
   *
   * A conta é obtida pela configuração administrativa
   * específica daquela candidatura.
   */

  async getMailboxCredentials(
    applicationId
  ) {

    if (
      !applicationId
    ) {

      throw new Error(
        "applicationId is required to read OTP mailbox"
      );
    }


    const credentials =
      await getCredentialsForAutomation(
        applicationId
      );


    if (
      !credentials?.email
    ) {

      const error =
        new Error(
          "VFS email is not configured for this application"
        );

      error.code =
        "OTP_EMAIL_REQUIRED";

      throw error;
    }


    if (
      !credentials?.password
    ) {

      const error =
        new Error(
          "VFS password is not configured for this application"
        );

      error.code =
        "OTP_EMAIL_PASSWORD_REQUIRED";

      throw error;
    }


    const email =
      this.normalizeEmail(
        credentials.email
      );


    const host =
      this.resolveImapHost(
        email
      );


    if (
      !host
    ) {

      const error =
        new Error(
          `Servidor IMAP não identificado para ${email}. Configure OTP_IMAP_HOST no Render.`
        );

      error.code =
        "OTP_IMAP_HOST_REQUIRED";

      throw error;
    }


    return {

      email,

      password:
        credentials.password,

      host,

      port:
        this.imapPort,

      secure:
        this.imapSecure,

      mailbox:
        this.imapMailbox
    };
  }


  /*
   * =======================================================
   * TEST MODE
   * =======================================================
   */

  async requestCode(
    request,
    destination = null
  ) {

    if (
      !request
    ) {

      throw new Error(
        "OTP request required"
      );
    }


    /*
     * O modo de teste continua disponível.
     */

    if (
      this.testMode
    ) {

      return {

        status:
          "sent",

        requestId:
          request.requestId,

        expiresAt:
          request.expiresAt,

        destination,

        testMode:
          true
      };
    }


    if (
      !this.enabled
    ) {

      throw new Error(
        "OTP service is disabled"
      );
    }


    /*
     * Validamos a caixa de entrada aqui.
     *
     * A leitura efetiva será feita por waitForCode().
     */

    const mailbox =
      await this.getMailboxCredentials(
        request.applicationId
      );


    return {

      status:
        "waiting",

      requestId:
        request.requestId,

      applicationId:
        request.applicationId,

      expiresAt:
        request.expiresAt,

      destination:
        mailbox.email,

      mailboxHost:
        mailbox.host
    };
  }


  /*
   * =======================================================
   * EXTRAIR TEXTO DE E-MAIL
   * =======================================================
   */

  async parseMessage(
    simpleParser,
    source
  ) {

    try {

      const parsed =
        await simpleParser(
          source
        );


      const subject =
        parsed.subject ||
        "";


      const from =
        parsed.from?.text ||
        "";


      const text =
        parsed.text ||
        "";


      const html =
        parsed.html ||
        "";


      return {

        subject:
          String(
            subject
          ),

        from:
          String(
            from
          ),

        text:
          `${text}\n${html}`

      };

    } catch (
      error
    ) {

      return {

        subject:
          "",

        from:
          "",

        text:
          "",

        parseError:
          error
      };
    }
  }


  /*
   * =======================================================
   * REMETENTE
   * =======================================================
   */

  senderAllowed(
    sender
  ) {

    if (
      this.allowedSenders.length === 0
    ) {

      return true;
    }


    const normalized =
      String(
        sender ||
        ""
      )
        .trim()
        .toLowerCase();


    return this.allowedSenders.some(
      allowed =>
        normalized.includes(
          allowed
        )
    );
  }


  /*
   * =======================================================
   * EXTRAIR OTP
   * =======================================================
   */

  extractCode(
    message
  ) {

    const subject =
      message?.subject ||
      "";


    const text =
      message?.text ||
      "";


    const combined =
      `${subject}\n${text}`;


    /*
     * Primeiro tentamos padrões sem ambiguidades.
     */

    for (
      const pattern of
      this.codePatterns
    ) {

      const match =
        combined.match(
          pattern
        );


      if (
        match?.[1]
      ) {

        const code =
          String(
            match[1]
          ).trim();


        if (
          this.validateCode(
            code
          )
        ) {

          return code;
        }
      }
    }


    /*
     * Fallback controlado:
     *
     * Procuramos números de 4-8 dígitos somente
     * quando o texto contém indicadores claros de OTP.
     */

    const hasOtpIndicator =
      /\b(?:otp|one[\s-]*time|verification|security|confirmation|authentication|c[oó]digo)\b/i
        .test(
          combined
        );


    if (
      !hasOtpIndicator
    ) {

      return null;
    }


    const candidates =
      combined.match(
        /\b\d{4,8}\b/g
      ) || [];


    for (
      const candidate of
      candidates
    ) {

      if (
        this.validateCode(
          candidate
        )
      ) {

        return candidate;
      }
    }


    return null;
  }


  /*
   * =======================================================
   * DATA DA MENSAGEM
   * =======================================================
   */

  getMessageDate(
    message
  ) {

    if (
      message?.date
    ) {

      const timestamp =
        new Date(
          message.date
        ).getTime();


      if (
        Number.isFinite(
          timestamp
        )
      ) {

        return timestamp;
      }
    }


    return 0;
  }


  /*
   * =======================================================
   * POLLING DA CAIXA DE ENTRADA
   * =======================================================
   */

  async waitForCode(
    request
  ) {

    if (
      !request
    ) {

      throw new Error(
        "OTP request required"
      );
    }


    if (
      this.testMode
    ) {

      if (
        !this.testCode
      ) {

        throw new Error(
          "OTP_TEST_CODE is required in test mode"
        );
      }


      return {

        status:
          "received",

        code:
          this.testCode,

        requestId:
          request.requestId,

        testMode:
          true
      };
    }


    if (
      !this.enabled
    ) {

      throw new Error(
        "OTP service is disabled"
      );
    }


    const {
      ImapFlow,
      simpleParser
    } =
      this.loadEmailDependencies();


    const mailbox =
      await this.getMailboxCredentials(
        request.applicationId
      );


    const startedAt =
      new Date(
        request.createdAt ||
        Date.now()
      ).getTime();


    const expiresAt =
      new Date(
        request.expiresAt
      ).getTime();


    if (
      !Number.isFinite(
        expiresAt
      )
    ) {

      throw new Error(
        "Invalid OTP expiration time"
      );
    }


    /*
     * Nunca procurar mensagens indefinidamente.
     */

    const deadline =
      Math.min(
        expiresAt,
        startedAt +
        this.searchWindowMs
      );


    let client = null;


    try {

      client =
        new ImapFlow({

          host:
            mailbox.host,

          port:
            mailbox.port,

          secure:
            mailbox.secure,

          auth: {

            user:
              mailbox.email,

            pass:
              mailbox.password

          },

          logger:
            false

        });


      await client.connect();


      await client.mailboxOpen(
        mailbox.mailbox,
        {
          readOnly:
            true
        }
      );


      /*
       * Procuramos mensagens recentes.
       *
       * Como a implementação depende do servidor IMAP,
       * fazemos uma janela por data e depois filtramos
       * exatamente pelo timestamp da solicitação.
       */

      while (
        Date.now() <
        deadline
      ) {

        let messagesFound =
          false;


        const searchSince =
          new Date(
            Math.max(
              startedAt -
              30000,
              Date.now() -
              this.searchWindowMs
            )
          );


        let uids = [];


        try {

          uids =
            await client.search(
              {
                since:
                  searchSince
              },
              {
                uid:
                  true
              }
            );

        } catch {

          /*
           * Alguns servidores IMAP podem rejeitar
           * determinadas formas de pesquisa.
           *
           * Nesse caso fazemos uma consulta ampla limitada
           * aos últimos UIDs.
           */

          uids = [];
        }


        /*
         * Se a pesquisa não encontrou UIDs, tentamos
         * consultar os últimos N e-mails.
         */

        if (
          !Array.isArray(uids) ||
          uids.length === 0
        ) {

          const status =
            client.mailbox;

          const exists =
            Number(
              status?.exists ||
              0
            );


          if (
            exists > 0
          ) {

            const start =
              Math.max(
                1,
                exists -
                this.maxMessagesPerPoll +
                1
              );


            const end =
              exists;


            try {

              const range =
                `${start}:${end}`;


              const fallbackUids =
                await client.search(
                  {
                    all:
                      true
                  },
                  {
                    uid:
                      true
                  }
                );


              if (
                Array.isArray(
                  fallbackUids
                )
              ) {

                uids =
                  fallbackUids.slice(
                    -this.maxMessagesPerPoll
                  );
              }

            } catch {
              uids = [];
            }
          }
        }


        if (
          Array.isArray(uids) &&
          uids.length > 0
        ) {

          /*
           * Limitamos o número de mensagens processadas.
           */

          uids =
            uids.slice(
              -this.maxMessagesPerPoll
            );


          for (
            const uid of
            uids.reverse()
          ) {

            try {

              const message =
                await client.fetchOne(
                  uid,
                  {
                    source:
                      true,

                    envelope:
                      true,

                    internalDate:
                      true
                  },
                  {
                    uid:
                      true
                  }
                );


              if (
                !message
              ) {

                continue;
              }


              messagesFound =
                true;


              const internalTimestamp =
                message.internalDate
                  ? new Date(
                      message.internalDate
                    ).getTime()
                  : 0;


              /*
               * Ignorar mensagens anteriores à solicitação.
               *
               * Tolerância de 30 segundos porque servidores
               * de e-mail podem ter pequenas diferenças de
               * timestamp.
               */

              if (
                internalTimestamp &&
                internalTimestamp <
                  startedAt -
                  30000
              ) {

                continue;
              }


              const parsed =
                await this.parseMessage(
                  simpleParser,
                  message.source
                );


              /*
               * Se o parser encontrou uma data própria,
               * usamos essa data como segunda proteção.
               */

              const parsedDate =
                this.getMessageDate(
                  parsed
                );


              if (
                parsedDate &&
                parsedDate <
                  startedAt -
                  30000
              ) {

                continue;
              }


              if (
                !this.senderAllowed(
                  parsed.from
                )
              ) {

                continue;
              }


              const code =
                this.extractCode(
                  parsed
                );


              if (
                !code
              ) {

                continue;
              }


              return {

                status:
                  "received",

                code,

                requestId:
                  request.requestId,

                applicationId:
                  request.applicationId,

                receivedAt:
                  new Date(),

                sender:
                  parsed.from,

                subject:
                  parsed.subject

              };

            } catch {
              /*
               * Uma mensagem malformada não pode
               * interromper a procura pelas restantes.
               */
              continue;
            }
          }
        }


        /*
         * Ainda não chegou.
         */

        if (
          Date.now() >=
          deadline
        ) {

          break;
        }


        await this.sleep(
          this.pollIntervalMs
        );
      }


      const timeoutError =
        new Error(
          "OTP email was not received before expiration"
        );


      timeoutError.code =
        "OTP_EMAIL_TIMEOUT";


      timeoutError.requestId =
        request.requestId;


      return {

        status:
          "expired",

        requestId:
          request.requestId,

        reason:
          timeoutError.message

      };

    } finally {

      if (
        client
      ) {

        try {

          await client.logout();

        } catch {
          try {
            await client.close();
          } catch {
            /*
             * Ignorar erro de encerramento.
             */
          }
        }
      }
    }
  }


  /*
   * =======================================================
   * SLEEP
   * =======================================================
   */

  sleep(
    milliseconds
  ) {

    return new Promise(
      resolve =>
        setTimeout(
          resolve,
          milliseconds
        )
    );
  }


  /*
   * =======================================================
   * GET CODE
   * =======================================================
   */

  async getCode(
    request
  ) {

    return this.waitForCode(
      request
    );
  }


  /*
   * =======================================================
   * VALIDAR FORMATO
   * =======================================================
   */

  validateCode(
    code
  ) {

    return (
      typeof code ===
        "string" &&
      /^\d{4,8}$/.test(
        code.trim()
      )
    );
  }


  /*
   * =======================================================
   * VERIFICAR OTP
   * =======================================================
   */

  async verifyCode({
    request,
    code,
    attempts = 0
  }) {

    if (
      !request
    ) {

      throw new Error(
        "OTP request required"
      );
    }


    const expiresAt =
      new Date(
        request.expiresAt
      ).getTime();


    if (
      !Number.isFinite(
        expiresAt
      ) ||
      expiresAt <=
        Date.now()
    ) {

      return {

        verified:
          false,

        status:
          "expired",

        requestId:
          request.requestId

      };
    }


    if (
      attempts >=
      this.maxAttempts
    ) {

      return {

        verified:
          false,

        status:
          "failed",

        requestId:
          request.requestId,

        reason:
          "maximum_attempts"

      };
    }


    if (
      !this.validateCode(
        code
      )
    ) {

      return {

        verified:
          false,

        status:
          "failed",

        requestId:
          request.requestId,

        reason:
          "invalid_format"

      };
    }


    /*
     * Modo de teste.
     */

    if (
      this.testMode
    ) {

      if (
        !this.testCode
      ) {

        throw new Error(
          "OTP_TEST_CODE is required in test mode"
        );
      }


      const supplied =
        Buffer.from(
          code.trim()
        );


      const expected =
        Buffer.from(
          this.testCode
        );


      const verified =
        supplied.length ===
          expected.length &&
        crypto.timingSafeEqual(
          supplied,
          expected
        );


      return {

        verified,

        status:
          verified
            ? "verified"
            : "failed",

        requestId:
          request.requestId,

        reason:
          verified
            ? null
            : "invalid_code"

      };
    }


    /*
     * No modo real, a própria leitura do e-mail
     * já encontrou o código.
     *
     * Fazemos a comparação de formato aqui para
     * manter a API de verificação compatível.
     */

    return {

      verified:
        true,

      status:
        "verified",

      requestId:
        request.requestId,

      reason:
        null

    };
  }
}


module.exports =
  OtpService;
