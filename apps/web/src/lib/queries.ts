import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  AdminStudentDTO, AnalyticsDTO, AnnouncementDTO, AuditEntryDTO, BatchItemResultDTO, CatalogItemDTO, CourseDTO,
  DemoAccountDTO, DropResultDTO, EnrollResultDTO, HoldDTO, InstructorDTO, MetaDTO, MyEnrollmentDTO, NotificationsDTO,
  OverloadRequestDTO, PageDTO, ProgressDTO, RecommendationDTO, RegistrationFormDTO, RosterEntryDTO, ScheduleDTO,
  SummaryDTO, TermDTO, TranscriptDTO, UserDTO, ValidationDTO,
} from "@enroll/shared";
import { api, ApiError } from "./api";

/** Seat counts change while people register, so lists that show them poll (and pause when the tab is hidden). */
export const POLL_MS = 15_000;

function useGet<T>(key: QueryKey, path: string | null, opts: { poll?: number; enabled?: boolean; staleTime?: number } = {}) {
  return useQuery({
    queryKey: key,
    queryFn: () => api<T>(path!),
    enabled: path !== null && (opts.enabled ?? true),
    refetchInterval: opts.poll,
    refetchIntervalInBackground: false,
    staleTime: opts.staleTime ?? 5_000,
  });
}

const qs = (params: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

// --- session -------------------------------------------------------------------------------------
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<UserDTO | null> => {
      try { return (await api<{ user: UserDTO }>("/auth/me")).user; }
      catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
    },
    staleTime: 60_000,
    retry: false,
  });
}
export const useDemoAccounts = () => useGet<{ accounts: DemoAccountDTO[] }>(["demo-accounts"], "/auth/demo-accounts", { staleTime: 60_000 });

// --- shared reference data --------------------------------------------------------------------------
export const useMeta = () => useGet<MetaDTO>(["meta"], "/meta", { staleTime: 60_000 });
export const useTerms = () => useGet<{ terms: TermDTO[] }>(["terms"], "/terms", { staleTime: 60_000 });
export const useAnnouncements = () => useGet<{ announcements: AnnouncementDTO[] }>(["announcements"], "/announcements");
export const useNotifications = () => useGet<NotificationsDTO>(["notifications"], "/me/notifications", { poll: 30_000 });

// --- catalog ---------------------------------------------------------------------------------------------
export type CatalogParams = Partial<{ termId: number; q: string; department: string; day: string; availability: string; minUnits: number; maxUnits: number; sort: string; page: number; pageSize: number }>;
export const useCourses = (p: CatalogParams) =>
  useGet<PageDTO<CatalogItemDTO> & { termId: number }>(["courses", p], `/courses${qs(p)}`, { poll: POLL_MS });
export const useCourse = (id: number | null) =>
  useGet<CatalogItemDTO & { prerequisiteTitles: Record<string, string> }>(["course", id], id ? `/courses/${id}` : null, { poll: POLL_MS });

/** Eligibility for a page of courses in one request: powers the "why can't I enroll?" tooltips. */
export function useValidation(courseIds: number[], cartIds: number[] = [], enabled = true) {
  const ids = [...new Set(courseIds)].sort((a, b) => a - b);
  const cart = [...new Set(cartIds)].sort((a, b) => a - b);
  return useQuery({
    queryKey: ["validate", ids, cart],
    queryFn: () => api<{ results: Record<number, ValidationDTO> }>("/enrollments/validate", { method: "POST", body: { courseIds: ids, cartCourseIds: cart } }),
    enabled: enabled && ids.length > 0,
    refetchInterval: POLL_MS * 2,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
}

// --- student ----------------------------------------------------------------------------------------------------
export const useSummary = () => useGet<SummaryDTO>(["summary"], "/me/summary");
export const useMyEnrollments = (termId?: number) =>
  useGet<{ enrollments: MyEnrollmentDTO[] }>(["my-enrollments", termId], `/me/enrollments${qs({ termId })}`, { poll: POLL_MS });
export const useSchedule = (termId?: number) => useGet<ScheduleDTO>(["schedule", termId], `/me/schedule${qs({ termId })}`);
export const useTranscript = () => useGet<TranscriptDTO>(["transcript"], "/me/transcript");
export const useProgress = () => useGet<ProgressDTO>(["progress"], "/me/progress");
export const useRecommendations = () => useGet<{ recommendations: RecommendationDTO[] }>(["recommendations"], "/me/recommendations", { poll: POLL_MS * 2 });
export const useRegistrationForm = (termId?: number) => useGet<RegistrationFormDTO>(["registration-form", termId], `/me/registration-form${qs({ termId })}`);
export const useMyOverloads = () => useGet<{ requests: OverloadRequestDTO[] }>(["my-overloads"], "/me/overload-requests");

// --- instructor ---------------------------------------------------------------------------------------------------
export const useInstructorCourses = (termId?: number) => useGet<{ courses: CourseDTO[] }>(["instructor-courses", termId], `/instructor/courses${qs({ termId })}`);
export const useRoster = (courseId: number | null, admin = false) =>
  useGet<{ course: CourseDTO; entries: RosterEntryDTO[] }>(["roster", courseId, admin], courseId ? `/${admin ? "admin" : "instructor"}/courses/${courseId}/roster` : null);

// --- admin ----------------------------------------------------------------------------------------------------------
export const useAdminStudents = (q: string, page: number) =>
  useGet<{ items: AdminStudentDTO[]; total: number; page: number; pageSize: number }>(["admin-students", q, page], `/admin/students${qs({ q, page, pageSize: 15 })}`);
export const useAdminInstructors = () => useGet<{ instructors: InstructorDTO[] }>(["admin-instructors"], "/admin/instructors");
export const useAdminHolds = (activeOnly: boolean) => useGet<{ holds: HoldDTO[] }>(["admin-holds", activeOnly], `/admin/holds${activeOnly ? "?active=1" : ""}`);
export const useAdminOverloads = (status?: string) => useGet<{ requests: OverloadRequestDTO[] }>(["admin-overloads", status], `/admin/overload-requests${qs({ status })}`);
export const useAudit = (p: { action?: string; page: number }) =>
  useGet<{ items: AuditEntryDTO[]; total: number; actions: string[]; page: number; pageSize: number }>(["audit", p], `/admin/audit${qs({ ...p, pageSize: 20 })}`);
export const useAnalytics = (termId?: number) => useGet<AnalyticsDTO>(["analytics", termId], `/admin/analytics${qs({ termId })}`, { poll: POLL_MS * 2 });

// --- mutations ------------------------------------------------------------------------------------------------------
/** Anything that changes enrollments or seats must refresh every screen that shows them. */
const ENROLLMENT_KEYS = ["courses", "course", "validate", "my-enrollments", "schedule", "summary", "recommendations", "notifications", "progress", "transcript", "registration-form", "roster", "analytics"];

export function useInvalidateEnrollment() {
  const qc = useQueryClient();
  return () => Promise.all(ENROLLMENT_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useEnroll() {
  const invalidate = useInvalidateEnrollment();
  return useMutation({
    mutationFn: (v: { courseId: number; allowWaitlist?: boolean }) => api<EnrollResultDTO>("/enrollments", { method: "POST", body: v }),
    onSettled: invalidate,
  });
}

export function useBatchEnroll() {
  const invalidate = useInvalidateEnrollment();
  return useMutation({
    mutationFn: (courseIds: number[]) => api<{ results: BatchItemResultDTO[] }>("/enrollments/batch", { method: "POST", body: { courseIds } }),
    onSettled: invalidate,
  });
}

/** Drop is the one action that is safe to show instantly: remove the row now, put it back if the server says no. */
export function useDrop() {
  const qc = useQueryClient();
  const invalidate = useInvalidateEnrollment();
  return useMutation({
    mutationFn: (enrollmentId: number) => api<DropResultDTO>(`/enrollments/${enrollmentId}`, { method: "DELETE" }),
    onMutate: async (enrollmentId) => {
      await qc.cancelQueries({ queryKey: ["my-enrollments"] });
      const snapshots = qc.getQueriesData<{ enrollments: MyEnrollmentDTO[] }>({ queryKey: ["my-enrollments"] });
      qc.setQueriesData<{ enrollments: MyEnrollmentDTO[] }>({ queryKey: ["my-enrollments"] }, (old) =>
        old ? { enrollments: old.enrollments.filter((e) => e.id !== enrollmentId) } : old);
      return { snapshots };
    },
    onError: (_e, _id, ctx) => ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: invalidate,
  });
}

/**
 * Generic write helper. `bodyOf` says what to send as the JSON body; by default the variables themselves.
 * Pass `() => undefined` for calls that identify their target in the URL (an id is not a valid JSON body).
 */
export function useApiMutation<TVars, TRes = unknown>(
  method: "POST" | "PUT" | "DELETE" | "PATCH",
  path: (v: TVars) => string,
  invalidateKeys: string[] = [],
  bodyOf: (v: TVars) => unknown = (v) => v,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => api<TRes>(path(vars), { method, body: method === "DELETE" ? undefined : bodyOf(vars) }),
    onSuccess: () => Promise.all(invalidateKeys.map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}
