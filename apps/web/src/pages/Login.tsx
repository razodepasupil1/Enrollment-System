import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { loginSchema } from "@enroll/shared";
import { SeatStrip } from "@/components/SeatStrip";
import { Badge, Button, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useDemoAccounts } from "@/lib/queries";
import { useAuth } from "@/lib/state";

export function Login() {
  const { login } = useAuth();
  const demo = useDemoAccounts();
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const accounts = demo.data?.accounts ?? [];

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="hidden flex-col justify-between bg-brand p-12 text-on-brand lg:flex" aria-hidden>
        <p className="font-display text-xl font-bold">Enrollment portal</p>
        <div className="max-w-md space-y-8">
          <h2 className="font-display text-4xl font-bold leading-tight">Know your seat before you enroll.</h2>
          <p className="text-lg opacity-90">Every course shows the seats left and who is waiting. If something is blocked, you see exactly why.</p>
          {/* A real course shown the way the app shows every course. The strip sits on a light plate so its colours keep their meaning. */}
          
        </div>
        <p className="text-sm opacity-80">Sign in with your school account.</p>
      </section>

      <main id="main" className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8">
          <div>
            <h1>Sign in</h1>
            <p className="mt-1 text-muted">Use the email and password for your student, instructor, or registrar account.</p>
          </div>
          <form onSubmit={handleSubmit((v) => login.mutate(v))} className="space-y-4" noValidate>
            <Field label="Email" error={errors.email?.message}>{(a) => <Input type="email" autoComplete="username" {...a} {...register("email")} />}</Field>
            <Field label="Password" error={errors.password?.message}>{(a) => <Input type="password" autoComplete="current-password" {...a} {...register("password")} />}</Field>
            {login.isError && <p role="alert" className="rounded-md bg-full-bg px-3 py-2 text-sm text-full">{errorMessage(login.error)}</p>}
            <Button type="submit" className="w-full" loading={login.isPending}>Sign in</Button>
          </form>

          {accounts.length > 0 && (
            <section aria-labelledby="demo-heading" className="space-y-3">
              <div>
                <h2 id="demo-heading" className="text-base">Try a demo account</h2>
                <p className="text-sm text-muted">One click, no password. Each account is set up to show a different part of the system.</p>
              </div>
              <ul className="space-y-2">
                {accounts.map((a) => (
                  <li key={a.email}>
                    <button type="button" onClick={() => login.mutate({ demo: a.email })} disabled={login.isPending}
                      className="flex w-full items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-sunken disabled:opacity-60">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-medium">{a.fullName}<Badge tone={a.role === "admin" ? "brand" : a.role === "instructor" ? "wait" : "neutral"}>{a.role}</Badge></span>
                        <span className="block text-sm text-muted">{a.note}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
