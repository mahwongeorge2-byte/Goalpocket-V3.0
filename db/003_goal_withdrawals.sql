-- Lets people take money back out of a goal (stored as a negative contribution).
-- Safe to run more than once.
alter table goal_contributions drop constraint if exists goal_contributions_amount_from_pocket_cents_check;
alter table goal_contributions drop constraint if exists goal_contributions_amount_to_goal_cents_check;
alter table goal_contributions drop constraint if exists goal_contrib_from_nonzero;
alter table goal_contributions drop constraint if exists goal_contrib_to_nonzero;
alter table goal_contributions add constraint goal_contrib_from_nonzero check (amount_from_pocket_cents <> 0);
alter table goal_contributions add constraint goal_contrib_to_nonzero check (amount_to_goal_cents <> 0);
