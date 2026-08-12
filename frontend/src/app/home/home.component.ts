import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SocialEntryComponent } from '../social-entry/social-entry.component';
import { MusicPlayerComponent } from '../music-player/music-player.component';
import { BackgroundComponent } from '../background/background.component';
import { BrainRotComponent } from '../brain-rot/brain-rot.component';
import { BackgroundAnimationService } from '../services/background-animation.service';
import { TerminalService } from '../terminal/services/terminal.service';
import { TerminalOutput } from '../terminal/types/terminal.types';
import { SlackNotificationService } from '../services/slack-notification.service';
import { Nl2brPipe } from '../pipes/nl2br.pipe';
import { 
  HelpCommand, 
  ClearCommand, 
  AboutCommand, 
  WorkCommand, 
  BlogCommand, 
  ContactCommand,
  CodeCommand,
  WhoAmICommand,
  SlackCommand,
  AlarmCommand,
  CountdownCommand,
  ShareholderCommand,
  BrainRotCommand
} from '../terminal/commands/index';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, CommonModule, SocialEntryComponent, MusicPlayerComponent, BackgroundComponent, BrainRotComponent, Nl2brPipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('terminalInput', { static: false }) terminalInput!: ElementRef<HTMLInputElement>;
  @ViewChild(BrainRotComponent) brainRot!: BrainRotComponent;
  
  lastLoginTime: string = '';
  greeting: string = '';
  systemInfo: string = '';
  helpText: string = '';
  prompt: string = '';
  currentCommand: string = '';
  terminalOutputs: TerminalOutput[] = [];
  isGlitching: boolean = false;
  
  private fullLastLoginTime: string;
  private fullGreeting: string;
  private fullSystemInfo: string;
  private fullHelpText: string;
  private isTyping: boolean = false;
  private terminalService: TerminalService;
  private glitchTimeout: any;
  private focusInterval: any;

  constructor(
    private router: Router,
    private backgroundAnimationService: BackgroundAnimationService,
    private notificationService: SlackNotificationService,
    private ngZone: NgZone
  ) {
    this.terminalService = new TerminalService();
    this.fullLastLoginTime = new Date().toLocaleString();
    this.fullGreeting = 'Welcome to Braelyn Boynton\'s personal site!';
    this.fullSystemInfo = 'Type "help" to see available commands, or explore the site using the navigation.';
    this.fullHelpText = 'Some available commands: help, about, work, blog, contact';
    
    this.initializeCommands();
  }

  ngOnInit(): void {
    this.startTypewriterEffect();
    this.startGlitchEffect();
  }

  ngAfterViewInit(): void {
    // Try to focus after view is initialized
    setTimeout(() => {
      this.focusTerminalInput();
    }, 2000); // Wait 2 seconds after view init
  }

  private initializeCommands(): void {
    // Register all basic commands
    this.terminalService.registerCommand(new HelpCommand(this.terminalService));
    this.terminalService.registerCommand(new ClearCommand());
    this.terminalService.registerCommand(new AboutCommand());
    this.terminalService.registerCommand(new WorkCommand());
    this.terminalService.registerCommand(new BlogCommand());
    this.terminalService.registerCommand(new ContactCommand());
    this.terminalService.registerCommand(new CodeCommand());
    this.terminalService.registerCommand(new WhoAmICommand());
    this.terminalService.registerCommand(new SlackCommand());
    this.terminalService.registerCommand(new AlarmCommand());
    this.terminalService.registerCommand(new CountdownCommand());
    this.terminalService.registerCommand(new ShareholderCommand());
    this.terminalService.registerCommand(new BrainRotCommand());
  }

  private async startTypewriterEffect(): Promise<void> {
    this.isTyping = true;
    
    // Type "Last login:" first
    await this.typeText('Last login: ', 'lastLoginTime');
    
    // Then type the timestamp
    await this.typeText(this.fullLastLoginTime, 'lastLoginTime', true);
    
    // Add a small delay before next line
    await this.delay(500);
    
    // Type greeting
    await this.typeText(this.fullGreeting, 'greeting');
    
    // Add a small delay before next line
    await this.delay(500);
    
    // Type system info
    await this.typeText(this.fullSystemInfo, 'systemInfo');
    
    // Add a small delay before next line
    await this.delay(500);
    
    // Type help text
    await this.typeText(this.fullHelpText, 'helpText');
    
    // Add a small delay before showing prompt
    await this.delay(500);
    
    // Type the prompt
    await this.typeText('root@personal-site:~$', 'prompt');
    
    this.isTyping = false;
    
    // Start the focus interval after typewriter effect completes
    this.startFocusInterval();
  }

  private async typeText(text: string, targetProperty: string, append: boolean = false): Promise<void> {
    const target = targetProperty as keyof this;
    
    if (!append) {
      (this as any)[target] = '';
    }
    
    for (let i = 0; i < text.length; i++) {
      (this as any)[target] += text[i];
      await this.delay(10); // Adjust speed here (lower = faster)
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  onKeyDown(event: KeyboardEvent): void {
    // Stop the focus interval when user starts typing
    this.stopFocusInterval();
    
    if (event.key === 'Enter') {
      this.executeCommand();
    }
  }

  async executeCommand(): Promise<void> {
    const command = this.currentCommand.trim();
    if (!command) {
      this.currentCommand = '';
      return;
    }

    this.currentCommand = '';

    try {
      // Create context with services for commands that need them
      const context = {
        notificationService: this.notificationService,
        backgroundAnimationService: this.backgroundAnimationService
      };
      
      const result = await this.terminalService.executeCommand(command, context);
      
      // Update terminal outputs
      this.terminalOutputs = [...this.terminalService.getRecentOutputs(50)];
      
      // Handle special actions
      if (result.action === 'clear') {
        this.clearTerminalDisplay();
      } else if (result.action === 'navigate' && result.data?.route) {
        this.router.navigate([result.data.route]);
      } else if (command.toLowerCase() === 'brainrot' || command.toLowerCase() === 'adhd' || command.toLowerCase() === 'rot' || command.toLowerCase() === 'video') {
        this.triggerBrainRot();
      }
      
      this.focusTerminalInput();
    } catch (error) {
      console.error('Command execution error:', error);
      this.focusTerminalInput();
    }
  }

  private clearTerminalDisplay(): void {
    this.terminalOutputs = [];
    this.terminalService.clearOutputs();
  }

  focusTerminalInput(): void {
    if (this.terminalInput) {
      this.terminalInput.nativeElement.focus();
    }
  }

  startFocusInterval(): void {
    if (this.focusInterval) {
      clearInterval(this.focusInterval);
    }

    // Focus every second. Runs outside the Angular zone so each tick doesn't
    // trigger app-wide change detection — focusing the input touches no bindings.
    this.ngZone.runOutsideAngular(() => {
      this.focusInterval = setInterval(() => {
        this.focusTerminalInput();
      }, 1000);
    });
  }

  stopFocusInterval(): void {
    if (this.focusInterval) {
      clearInterval(this.focusInterval);
      this.focusInterval = null;
    }
  }

  getOutputClass(type: string): string {
    switch (type) {
      case 'command':
        return 'command-text';
      case 'output':
        return 'output-text';
      case 'error':
        return 'error-text';
      case 'system':
        return 'system-text';
      default:
        return 'output-text';
    }
  }

  private startGlitchEffect(): void {
    // Schedule the first glitch effect
    this.scheduleNextGlitch();
  }

  private scheduleNextGlitch(): void {
    // Generate random delay between 2 and 15 seconds
    const randomDelay = Math.random() * 8000 + 2000; // 2000ms to 15000ms
    
    this.glitchTimeout = setTimeout(() => {
      this.triggerGlitchEffect();
      this.scheduleNextGlitch(); // Schedule the next one
    }, randomDelay);
  }

  private triggerGlitchEffect(): void {
    if (this.isTyping) {
      return; // Don't glitch while typing
    }
    
    // Generate random width between 2 and 20 pixels
    const randomWidth = Math.random() * 18 + 2; // 2 to 20 pixels
    const roundedWidth = Math.round(randomWidth * 10) / 10; // Round to 1 decimal place
    
    // Apply random width to CSS custom property
    document.documentElement.style.setProperty('--glitch-width', `${roundedWidth}px`);
    
    this.isGlitching = true;
    
    // Remove glitch effect after animation completes
    setTimeout(() => {
      this.isGlitching = false;
    }, 100); // Match the CSS animation duration
  }

  testSlackNotification(): void {
    const names = ['John Doe', 'Jane Smith', 'Mike Johnson', 'Sarah Wilson', 'Alex Brown'];
    const messages = [
      'Hey, how are you doing?',
      'Can you review the latest changes?',
      'Meeting in 10 minutes!',
      'The build is ready for deployment',
      'Thanks for the help with the bug fix!'
    ];
    
    const randomName = names[Math.floor(Math.random() * names.length)];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    
    this.notificationService.addNotification(randomName, randomMessage);
  }

  /**
   * Triggers the brain rot video
   */
  triggerBrainRot(): void {
    if (this.brainRot) {
      this.brainRot.startBrainRot();
    }
  }

  ngOnDestroy(): void {
    if (this.glitchTimeout) {
      clearTimeout(this.glitchTimeout);
    }
    if (this.focusInterval) {
      clearInterval(this.focusInterval);
    }
  }
}
