import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { CardDrawerComponent } from './card-drawer.component';
import { KanbanCardDto, KanbanService } from './kanban.service';
import { AuthService } from '../core/auth.service';

const MOCK_TECHS = [
  { userId: 'u1', fullName: 'Peter Rogers', isPrimary: true,  skillLevel: 3 },
  { userId: 'u2', fullName: 'Marcus Webb',  isPrimary: false, skillLevel: 2 },
];

const TECH_USER  = { id: '1', fullName: 'Tech',       roles: ['TECHNICIAN'], username: 'tech', email: null };
const SUPER_USER = { id: '2', fullName: 'Supervisor',  roles: ['SUPERVISOR'], username: 'sup',  email: null };

const MOCK_CARD: KanbanCardDto = {
  roId: 'aaaaaaaa-0000-0000-0000-000000000001',
  roNumber: 'RO99001',
  customerName: 'DFE',
  priority: 2,
  requiredDate: '2026-09-01T00:00:00Z',
  bodyType: 'TIPPER_CS',
  track: 'BODY',
  stationId: 20,
  stationCode: 'FAB_LINE',
  stationName: 'Fabrication Line',
  gateState: 'IN_PROGRESS',
  gateReason: null,
  estimatedHours: 14,
  actualHours: 5.5,
  totalTasks: 2,
  completedTasks: 1,
  sourcePdfUrl: '/uploads/sample.pdf',
  hasManualOverride: false,
  tasks: [
    {
      id: 't1', sequence: 1, jobCodeLine: 'TP42N-001',
      operationName: 'CNC + base',
      assignedToUserId: null, assignedToName: 'Peter R',
      estimatedHours: 5.5, actualHours: 5.5, status: 'COMPLETED',
      flowTrack: 'BODY', notes: null,
    },
    {
      id: 't2', sequence: 2, jobCodeLine: 'TP42N-002',
      operationName: 'Mfr headboard',
      assignedToUserId: null, assignedToName: null,
      estimatedHours: 2.5, actualHours: 0, status: 'PENDING',
      flowTrack: 'BODY', notes: null,
    },
  ],
};

function configureTestBed(user = TECH_USER) {
  TestBed.configureTestingModule({
    imports: [CardDrawerComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { user: () => user } },
      {
        provide: KanbanService,
        useValue: {
          getTechnicians: jasmine.createSpy('getTechnicians').and.returnValue(of(MOCK_TECHS)),
          assignTask:     jasmine.createSpy('assignTask').and.returnValue(of(undefined)),
          getFlow:        jasmine.createSpy('getFlow').and.returnValue(of({ roId: MOCK_CARD.roId, bodyType: null, tracks: [] })),
        },
      },
    ],
  });
}

describe('CardDrawerComponent', () => {
  describe('as non-supervisor (TECHNICIAN)', () => {
    beforeEach(() => configureTestBed(TECH_USER));

    it('does not render drawer when isOpen is false', () => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.drawer-bg')).toBeNull();
    });

    it('renders all tasks when open', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();
      tick(400);
      fixture.detectChanges();

      const rows = fixture.nativeElement.querySelectorAll('.task-row');
      expect(rows.length).toBe(2);
      expect(rows[0].classList).toContain('done');
      expect(rows[0].querySelector('.task-row-name').textContent).toContain('CNC + base');
      expect(rows[1].querySelector('.task-row-name').textContent).toContain('Mfr headboard');

      fixture.destroy();
    }));

    it('shows PDF iframe after deferred load when sourcePdfUrl is set', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.pdf-frame')).toBeNull();

      tick(400);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.pdf-frame')).toBeTruthy();

      fixture.destroy();
    }));

    it('shows empty state with title, body line, and upload link when sourcePdfUrl is null', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', { ...MOCK_CARD, sourcePdfUrl: null });
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();
      tick(400);
      fixture.detectChanges();

      const empty = fixture.nativeElement.querySelector('.pdf-empty');
      expect(empty).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.pdf-empty-title').textContent.trim())
        .toBe('No source PDF on file');
      expect(fixture.nativeElement.querySelector('.pdf-empty-body').textContent.trim())
        .toBe("Sales hasn't uploaded the original RO document yet.");

      const link = fixture.nativeElement.querySelector('.pdf-empty-link');
      expect(link).toBeTruthy();
      expect(link.getAttribute('href')).toContain(MOCK_CARD.roId);

      fixture.destroy();
    }));

    it('navigates to /tech/tasks/:id when task row is clicked', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navSpy = spyOn(router, 'navigate');

      fixture.nativeElement.querySelectorAll('.task-row')[0].click();
      expect(navSpy).toHaveBeenCalledWith(['/tech/tasks', 't1']);

      tick(400);
      fixture.destroy();
    }));

    it('emits closed when Escape is pressed while open', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      let wasClosed = false;
      fixture.componentInstance.closed.subscribe(() => (wasClosed = true));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(wasClosed).toBeTrue();

      tick(400);
      fixture.destroy();
    }));

    it('does not emit closed on Escape when drawer is closed', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();

      let wasClosed = false;
      fixture.componentInstance.closed.subscribe(() => (wasClosed = true));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(wasClosed).toBeFalse();

      fixture.destroy();
    }));

    it('renders BODY track chip with body class', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      const chip = fixture.nativeElement.querySelector('.task-row-track.body');
      expect(chip).toBeTruthy();
      expect(chip.textContent.trim()).toBe('Body');

      tick(400);
      fixture.destroy();
    }));
  });

  describe('as supervisor', () => {
    beforeEach(() => configureTestBed(SUPER_USER));

    it('shows inline action menu when supervisor clicks a task row', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.task-row-menu')).toBeNull();

      fixture.nativeElement.querySelectorAll('.task-row')[0].click();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector('.task-row-menu');
      expect(menu).toBeTruthy();
      const link = menu.querySelector('.task-row-menu-item');
      expect(link.getAttribute('href')).toContain('t1');

      tick(400);
      fixture.destroy();
    }));

    it('toggles menu off when the same row is clicked again', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      const rows = fixture.nativeElement.querySelectorAll('.task-row');
      rows[0].click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.task-row-menu')).toBeTruthy();

      rows[0].click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.task-row-menu')).toBeNull();

      tick(400);
      fixture.destroy();
    }));

    it('switches menu to a different row when another row is clicked', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      const rows = fixture.nativeElement.querySelectorAll('.task-row');
      rows[0].click();
      fixture.detectChanges();
      expect(fixture.componentInstance.activeMenuTaskId()).toBe('t1');

      rows[1].click();
      fixture.detectChanges();
      expect(fixture.componentInstance.activeMenuTaskId()).toBe('t2');

      tick(400);
      fixture.destroy();
    }));

    it('shows technician dropdown in menu after loading', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();
      tick(0); // flush getTechnicians observable

      fixture.nativeElement.querySelectorAll('.task-row')[0].click();
      fixture.detectChanges();

      const select = fixture.nativeElement.querySelector('.task-row-menu-select');
      expect(select).toBeTruthy();
      const options = select.querySelectorAll('option');
      // "Unassign" + 2 technicians
      expect(options.length).toBe(3);
      expect(options[1].textContent).toContain('Peter Rogers');

      tick(400);
      fixture.destroy();
    }));

    it('calls assignTask with correct userId when technician selected', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();
      tick(0);

      fixture.nativeElement.querySelectorAll('.task-row')[0].click();
      fixture.detectChanges();

      const svc = TestBed.inject(KanbanService);
      const select = fixture.nativeElement.querySelector('.task-row-menu-select') as HTMLSelectElement;
      select.value = 'u1';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(svc.assignTask).toHaveBeenCalledWith('t1', 'u1');

      tick(3500); // flush success message timeout
      fixture.destroy();
    }));

    it('closes menu on Escape before closing drawer', fakeAsync(() => {
      const fixture = TestBed.createComponent(CardDrawerComponent);
      fixture.componentRef.setInput('card', MOCK_CARD);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      fixture.nativeElement.querySelectorAll('.task-row')[0].click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.task-row-menu')).toBeTruthy();

      let wasClosed = false;
      fixture.componentInstance.closed.subscribe(() => (wasClosed = true));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.task-row-menu')).toBeNull();
      expect(wasClosed).toBeFalse();

      tick(400);
      fixture.destroy();
    }));
  });
});
