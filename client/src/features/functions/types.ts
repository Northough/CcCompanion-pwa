export type ScheduleStatus = 'pending' | 'done';

export interface ScheduleSubtask {
  id: string;
  title: string;
  done: boolean;
}

export interface ScheduleItem {
  id: string;
  date: string;
  title: string;
  starts_at: string;
  ends_at?: string;
  status: ScheduleStatus;
  type?: string;
  note?: string;
  subtasks: ScheduleSubtask[];
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}
