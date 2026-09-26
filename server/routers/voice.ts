import { z } from "zod";
import { createTRPCRouter, orgProcedure } from "../trpc";
import {
  VOICE_LANGUAGES,
  VOICE_MODEL_IDS,
  VOICE_MODELS,
  downloadModel,
  getVoiceStatus,
  isVoiceModelId,
  type VoiceLanguage,
} from "../services/voice.service";

// Voice input in the AI chat: the user's on/off switch, model and language,
// plus the state of the local engine and model download (Settings page and
// the chat's mic button both read `status`).

async function settingsOf(
  db: import("@prisma/client").PrismaClient,
  userId: string
): Promise<{ enabled: boolean; model: (typeof VOICE_MODEL_IDS)[number]; language: VoiceLanguage }> {
  const u = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { voiceInputEnabled: true, voiceModel: true, voiceLanguage: true },
  });
  return {
    enabled: u.voiceInputEnabled,
    model: isVoiceModelId(u.voiceModel) ? u.voiceModel : "small",
    language: (VOICE_LANGUAGES as readonly string[]).includes(u.voiceLanguage)
      ? (u.voiceLanguage as VoiceLanguage)
      : "auto",
  };
}

async function statusFor(db: import("@prisma/client").PrismaClient, userId: string) {
  const settings = await settingsOf(db, userId);
  return {
    ...settings,
    ...getVoiceStatus(settings.model),
    models: VOICE_MODEL_IDS.map((id) => ({
      id,
      label: VOICE_MODELS[id].label,
      sizeMB: VOICE_MODELS[id].sizeMB,
    })),
  };
}

export const voiceRouter = createTRPCRouter({
  status: orgProcedure.query(({ ctx }) => statusFor(ctx.db, ctx.user.id)),

  /** Turn voice input on/off, or change model / language. Turning it on
   *  starts the model download if it isn't on this machine yet. */
  updateSettings: orgProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        model: z.enum(VOICE_MODEL_IDS).optional(),
        language: z.enum(VOICE_LANGUAGES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({
        where: { id: ctx.user.id },
        data: {
          voiceInputEnabled: input.enabled,
          voiceModel: input.model,
          voiceLanguage: input.language,
        },
      });
      const s = await settingsOf(ctx.db, ctx.user.id);
      if (s.enabled) void downloadModel(s.model);
      return statusFor(ctx.db, ctx.user.id);
    }),

  /** Retry a failed or interrupted download (it resumes where it stopped). */
  downloadModel: orgProcedure.mutation(async ({ ctx }) => {
    const s = await settingsOf(ctx.db, ctx.user.id);
    void downloadModel(s.model);
    return statusFor(ctx.db, ctx.user.id);
  }),
});
