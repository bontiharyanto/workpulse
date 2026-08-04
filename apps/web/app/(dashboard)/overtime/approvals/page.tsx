import { OvertimeApprovalList } from '@/components/features/overtime/overtime-approval-list';
import { OvertimeCompletionRunner } from '@/components/features/overtime/overtime-completion-runner';

export default function OvertimeApprovalsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Approval Lembur</h1>
        <p className="text-muted-foreground text-sm">
          Supervisor melihat pengajuan dari tim langsung; HR Manager &amp; Super Admin melihat
          seluruh pengajuan tenant. Klik &quot;Putuskan&quot; untuk menyetujui atau menolak.
        </p>
      </header>

      <OvertimeCompletionRunner />

      <OvertimeApprovalList />
    </div>
  );
}
