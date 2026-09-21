import { Component, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './components/navbar/navbar.component';
import { UserTrackerComponent } from './components/user-tracker/user-tracker.component';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { LoginComponent } from './components/login/login.component';
import { AuthService } from './services/auth.service';
import { UserRole } from './models/time-tracker.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    NavbarComponent,
    UserTrackerComponent,
    AdminDashboardComponent,
    LoginComponent,
  ],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  currentRole = signal<UserRole>('user');

  constructor(public authService: AuthService) {
    effect(() => {
      if (this.authService.isAdmin()) {
        this.currentRole.set('admin');
      } else {
        this.currentRole.set('user');
      }
    });
  }

  onRoleChange(role: UserRole): void {
    if (!this.authService.isAdmin() && role === 'admin') {
      return; // Normal users can never access admin view
    }
    this.currentRole.set(role);
  }
}
