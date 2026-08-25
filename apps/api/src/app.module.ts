import { Module } from '@nestjs/common'
import { ImportCommand } from './commands/import.command.js'

@Module({ providers: [ImportCommand] })
export class AppModule {}
