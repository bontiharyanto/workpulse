import { ApprovalList } from '@/components/features/leave/approval-list';

export default function LeaveApprovalsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Approval Cuti</h1>
        <p className="text-sm text-muted-foreground">
          Setujui atau tolak pengajuan cuti sesuai tingkatan role Anda. Supervisor melihat pengajuan
          dari tim langsung; HR Manager melihat pengajuan yang sudah lolos level 1.
        </p>
      </header>
      <ApprovalList />
    </div>
  );
}
