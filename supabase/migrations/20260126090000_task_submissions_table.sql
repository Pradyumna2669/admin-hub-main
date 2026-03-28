-- Create task_submissions table for workers to submit their work
CREATE TABLE IF NOT EXISTS task_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submission_links TEXT[] DEFAULT '{}', -- Array of links submitted by worker
  screenshot_urls TEXT[] DEFAULT '{}', -- Array of screenshot URLs
  submission_notes TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  admin_notes TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX idx_task_submissions_task_id ON task_submissions(task_id);
CREATE INDEX idx_task_submissions_user_id ON task_submissions(user_id);
CREATE INDEX idx_task_submissions_status ON task_submissions(status);
CREATE INDEX idx_task_submissions_submitted_at ON task_submissions(submitted_at DESC);

-- Enable RLS
ALTER TABLE task_submissions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Workers can create and view their own submissions
CREATE POLICY "Workers can create submissions for their tasks"
  ON task_submissions
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Workers can view their own submissions"
  ON task_submissions
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Workers can update their own submissions if pending"
  ON task_submissions
  FOR UPDATE
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- RLS Policy: Admins can view all submissions and update statuses
CREATE POLICY "Admins can view all submissions"
  ON task_submissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can verify submissions"
  ON task_submissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
