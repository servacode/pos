import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiErrorBody, ErrorCode } from '@serva/core';
import { AppError } from '../errors';
import { RATE_LIMITED_MESSAGE } from './rate-limit';

/**
 * Transport errors keep their real status (413, 415, 405…), so a device can react: split a batch
 * that is too large, fix its content type. Each answer carries `ref`, the request id that appears
 * in every log line of that request and in the user's error centre.
 */
const TRANSPORT_ERRORS: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: 'validation_failed', message: 'الطلب غير صالح.' },
  401: { code: 'unauthorized', message: 'انتهت الجلسة. سجّل الدخول من جديد.' },
  403: { code: 'forbidden', message: 'لا تملك صلاحية هذا الإجراء.' },
  404: { code: 'not_found', message: 'غير موجود.' },
  405: { code: 'method_not_allowed', message: 'هذا الإجراء غير مسموح على هذا العنوان.' },
  409: { code: 'conflict', message: 'تعارض مع طلب آخر. أعد المحاولة.' },
  413: { code: 'payload_too_large', message: 'حجم الطلب أكبر من المسموح. قسّمه إلى أجزاء أصغر.' },
  415: { code: 'unsupported_media_type', message: 'نوع المحتوى غير مقبول.' },
  429: { code: 'rate_limited', message: RATE_LIMITED_MESSAGE },
  503: { code: 'unavailable', message: 'الخادم مشغول حالياً. حاول بعد قليل.' },
};

const INTERNAL = { code: 'internal', message: 'حدث خطأ غير متوقع. حاول مجدداً بعد قليل.' } as const;

const bodyOf = (code: ErrorCode, message: string, ref: string): ApiErrorBody => ({
  error: { code, message, ref },
});

export function installErrorHandling(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, 'request failed');
      return reply.status(error.statusCode).send(error.toBody(request.id));
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 400 && status < 500) {
      const known = TRANSPORT_ERRORS[status] ?? { code: 'bad_request', message: 'الطلب غير صالح.' };
      return reply.status(status).send(bodyOf(known.code, known.message, request.id));
    }
    request.log.error({ err: error }, 'request failed');
    if (status === 503) {
      const busy = TRANSPORT_ERRORS[503]!;
      return reply.status(503).send(bodyOf(busy.code, busy.message, request.id));
    }
    return reply.status(500).send(bodyOf(INTERNAL.code, INTERNAL.message, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    const notFound = TRANSPORT_ERRORS[404]!;
    return reply.status(404).send(bodyOf(notFound.code, notFound.message, request.id));
  });
}
